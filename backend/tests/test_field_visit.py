"""Field visits: a client from just an address, rooms and shots sent from a phone that
may repeat itself, the AI naming rooms without overruling anyone, photos moving to a
claim, company scope, and the address lookup. On a throwaway SQLite database."""

from datetime import datetime
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase, get_db_session
from app.domains.auth.dependencies import get_current_staff
from app.domains.client.models import Claim, Client
from app.domains.company.models import Company, CompanyContact
from app.domains.contract.models import ClaimCompany, ContractInstance, ContractTemplate
from app.domains.contract.onsite_signing_api import _known_values, named_after_address
from app.domains.field_visit import api as field_api
from app.domains.field_visit import geocode, room_reader
from app.domains.field_visit.models import FieldRoom, FieldShot, FieldVisit
from app.domains.file.models import File
from app.domains.staff.models import Staff, StaffCompany, StaffRole
from app.domains.water_mitigation.models import WaterMitigationJob, WMSheetPAMapping
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

sqlite3.register_adapter(uuid.UUID, str)


@compiles(JSONB, 'sqlite')
def jsonb_as_json(type_, compiler, **kw):
    return 'JSON'


TABLES = [
    Staff, StaffCompany, Company, CompanyContact, Client, Claim, ClaimCompany, File, ContractTemplate, ContractInstance,
    FieldVisit, FieldRoom, FieldShot, WaterMitigationJob, WMSheetPAMapping,
]

STREET = '12 Elm St'
JPEG = b'\xff\xd8\xff\xe0 not really a photo'


def make_staff(first, role):
    return Staff(
        staff_number=f'S-{first}', first_name=first, last_name='Test',
        email=f'{first.lower()}@example.com', username=first.lower(),
        role=role, hire_date=datetime(2026, 1, 1),
    )


class FakeStorage:
    provider_name = 'local'

    def __init__(self):
        self.uploads = []

    def upload(self, file_data, filename, context, context_id, category=None, content_type=None, optimize=True, **_):
        self.uploads.append({'context': context, 'context_id': context_id, 'optimize': optimize})
        name = f"{uuid.uuid4()}-{filename}"
        return SimpleNamespace(file_id=name, file_url=f"{context}/{context_id}/{name}", thumbnail_url=None)


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF'))
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    # Nothing here may reach the real database, whatever the env file points at
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)
    monkeypatch.setattr(room_reader, 'get_database', lambda: database)

    storage = FakeStorage()
    monkeypatch.setattr(field_api.StorageFactory, 'get_instance', lambda *_: storage)
    queued = []
    monkeypatch.setattr(field_api, 'queue_processing', lambda owner, file_id: queued.append(file_id))
    read = []
    monkeypatch.setattr(field_api, 'read_room_of_shot', lambda shot_id, image: read.append(shot_id))
    monkeypatch.setattr(room_reader, 'can_read_rooms', lambda: True)

    session = database.get_session()
    admin = make_staff('Admin', StaffRole.admin)
    field = make_staff('Field', StaffRole.contractor)
    outsider = make_staff('Other', StaffRole.contractor)
    loner = make_staff('Loner', StaffRole.contractor)
    bethany = Company(name='Bethany', company_type='contractor', is_active=True)
    rival = Company(name='Rival', company_type='contractor', is_active=True)
    for row in (admin, field, outsider, loner, bethany, rival):
        session.add(row)
    session.flush()
    session.add(StaffCompany(staff_id=field.id, company_id=bethany.id))
    session.add(StaffCompany(staff_id=outsider.id, company_id=rival.id))
    session.commit()

    application = FastAPI()
    application.include_router(field_api.router, prefix='/api/field-visits')

    def use_db():
        db = database.get_session()
        try:
            yield db
        finally:
            db.close()

    application.dependency_overrides[get_db_session] = use_db
    who = {'staff': field}
    application.dependency_overrides[get_current_staff] = lambda: who['staff']
    api = TestClient(application)

    yield SimpleNamespace(
        api=api, who=who, session=session, database=database, storage=storage, queued=queued, read=read,
        admin=admin, field=field, outsider=outsider, loner=loner,
        bethany_id=str(bethany.id), rival_id=str(rival.id),
    )
    session.close()


def start(env, street=STREET, **extra):
    response = env.api.post('/api/field-visits/', json={
        'address': {'street': street, 'city': 'Fairfax', 'state': 'VA', 'zipcode': '22030'},
        **extra,
    })
    assert response.status_code == 200, response.text
    return response.json()


def save_room(env, visit_id, room_id=None, **fields):
    room_id = room_id or str(uuid.uuid4())
    body = {'name': 'Room 1', 'floor': '1', **fields}
    response = env.api.put(f'/api/field-visits/{visit_id}/rooms/{room_id}', json=body)
    assert response.status_code == 200, response.text
    return room_id


def send_shot(env, visit_id, room_id, shot_id=None, filename='a.jpg', content_type='image/jpeg', **form):
    shot_id = shot_id or str(uuid.uuid4())
    return shot_id, env.api.post(
        f'/api/field-visits/{visit_id}/shots',
        data={'shot_id': shot_id, 'room_id': room_id, **form},
        files={'file': (filename, JPEG, content_type)},
    )


def detail(env, visit_id):
    response = env.api.get(f'/api/field-visits/{visit_id}')
    assert response.status_code == 200, response.text
    return response.json()


# ── Starting from an address ────────────────────────────────────────────────


def test_an_address_alone_makes_a_client_named_after_it(env):
    visit = start(env, altitude=112.5, altitude_accuracy=4.0)
    assert visit['client_created'] is True

    client = env.session.query(Client).filter(Client.id == visit['client_id']).one()
    assert client.display_name == STREET
    assert client.owners == []
    assert client.normalized_address == '12 elm st'
    assert str(client.company_id) == env.bethany_id
    assert named_after_address(client)

    row = env.session.query(FieldVisit).one()
    assert row.ground_altitude == 112.5


def test_no_address_is_refused(env):
    response = env.api.post('/api/field-visits/', json={'address': {'street': '   '}})
    assert response.status_code == 400


def test_someone_with_no_company_can_not_make_a_client(env):
    env.who['staff'] = env.loner
    response = env.api.post('/api/field-visits/', json={'address': {'street': STREET}})
    assert response.status_code == 400


def test_the_same_address_carries_on_with_the_same_client_and_visit(env):
    first = start(env)
    # Typed differently, the normalized address still matches
    again = start(env, street='12 Elm Street')
    assert again['client_id'] == first['client_id']
    assert again['id'] == first['id']
    assert again['client_created'] is False
    assert again['resumed'] is True
    assert env.session.query(Client).count() == 1


def test_a_visit_goes_stale_and_the_next_one_is_new(env):
    first = start(env)
    visit = env.session.query(FieldVisit).one()
    visit.last_activity_at = datetime(2020, 1, 1)
    env.session.commit()
    again = start(env)
    assert again['client_id'] == first['client_id']
    assert again['id'] != first['id']


def test_another_companys_client_at_that_address_stays_out_of_sight(env):
    first = start(env)
    env.who['staff'] = env.outsider
    theirs = start(env)
    assert theirs['client_id'] != first['client_id']
    assert env.api.get(f"/api/field-visits/{first['id']}").status_code == 404
    assert [row['id'] for row in env.api.get('/api/field-visits/').json()['visits']] == [theirs['id']]


def test_an_existing_client_can_start_a_visit(env):
    client = Client(display_name='Pat', owners=[], address='9 Oak', company_id=env.bethany_id, is_active=True)
    env.session.add(client)
    env.session.commit()
    response = env.api.post('/api/field-visits/', json={'client_id': str(client.id)})
    assert response.status_code == 200
    assert response.json()['client_created'] is False
    # Someone without access to the client gets nothing
    env.who['staff'] = env.outsider
    assert env.api.post('/api/field-visits/', json={'client_id': str(client.id)}).status_code == 404


def test_companies_list_what_a_new_client_can_go_under(env):
    found = env.api.get('/api/field-visits/companies').json()
    assert [row['id'] for row in found['companies']] == [env.bethany_id]
    assert found['default_id'] == env.bethany_id
    env.who['staff'] = env.admin
    assert {row['id'] for row in env.api.get('/api/field-visits/companies').json()['companies']} == {
        env.bethany_id, env.rival_id,
    }


# ── The signing side of a client with no name yet ───────────────────────────


def test_only_a_client_named_after_its_address_counts_as_having_no_name(env):
    imported = Client(display_name='Pat Client', owners=[], address='9 Oak', is_active=True)
    owned = Client(display_name='9 Oak', owners=[{'name': 'Pat'}], address='9 Oak', is_active=True)
    assert not named_after_address(imported)
    assert not named_after_address(owned)
    assert named_after_address(Client(display_name='9 Oak', owners=[], address='9 Oak'))


def test_a_contract_asks_for_the_name_of_a_client_named_after_its_address(env):
    visit = start(env)
    company = SimpleNamespace(name='Bethany', address=None, phone=None, email=None, license_number=None)
    known = _known_values(env.session, company, visit['client_id'], None)
    assert known['client']['display_name'] is None
    assert known['client']['address'] == STREET


# ── Rooms and shots ─────────────────────────────────────────────────────────


def test_a_shot_is_filed_under_its_room(env):
    visit = start(env)
    room_id = save_room(env, visit['id'], name='Kitchen', floor='2', floor_source='user', room_type='kitchen')
    shot_id, response = send_shot(
        env, visit['id'], room_id, kind='wall', wall='3', altitude='115.1', altitude_accuracy='6', heading='92.5',
    )
    assert response.status_code == 200, response.text

    row = env.session.query(File).one()
    assert row.context == 'field-visit'
    assert row.context_id == visit['id']
    assert row.category == '2nd floor · Kitchen'
    assert row.uploaded_by == str(env.field.id)

    shot = env.session.query(FieldShot).filter(FieldShot.id == shot_id).one()
    assert (shot.wall, shot.altitude, shot.heading) == (3, 115.1, 92.5)

    found = detail(env, visit['id'])
    assert found['rooms'][0]['name'] == 'Kitchen'
    assert found['shots'][0]['id'] == shot_id
    assert found['shots'][0]['url'] == f"/api/files/download/{row.id}?inline=true"


def test_no_connection_is_held_while_a_shot_goes_to_storage(env, monkeypatch):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    env.session.commit()

    engine = env.session._session.get_bind()
    connections = {'out': 0}
    sa.event.listen(engine, 'checkout', lambda *_: connections.update(out=connections['out'] + 1))
    sa.event.listen(engine, 'checkin', lambda *_: connections.update(out=connections['out'] - 1))
    upload = env.storage.upload
    out_while_uploading = []

    def waited_on(*args, **kwargs):
        out_while_uploading.append(connections['out'])
        return upload(*args, **kwargs)

    monkeypatch.setattr(env.storage, 'upload', waited_on)
    shot_id, response = send_shot(env, visit['id'], room_id, filename='a.mp4', content_type='video/mp4', kind='video')
    assert response.status_code == 200, response.text
    assert out_while_uploading == [0]
    assert env.session.query(FieldShot).filter(FieldShot.id == shot_id).count() == 1


def test_sending_a_shot_again_saves_it_once(env):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    shot_id, first = send_shot(env, visit['id'], room_id)
    _, second = send_shot(env, visit['id'], room_id, shot_id=shot_id)
    assert second.status_code == 200
    assert second.json()['file_id'] == first.json()['file_id']
    assert env.session.query(File).count() == 1
    assert len(env.storage.uploads) == 1


def test_a_shot_before_its_room_is_saved_asks_for_the_room(env):
    visit = start(env)
    _, response = send_shot(env, visit['id'], str(uuid.uuid4()))
    assert response.status_code == 409
    assert env.session.query(File).count() == 0


def test_someone_elses_shot_or_room_id_can_not_be_taken_over(env):
    mine = start(env)
    room_id = save_room(env, mine['id'])
    shot_id, _ = send_shot(env, mine['id'], room_id)
    env.who['staff'] = env.outsider
    theirs = start(env, street='1 Pine Rd')
    assert env.api.put(
        f"/api/field-visits/{theirs['id']}/rooms/{room_id}", json={'name': 'Mine now'},
    ).status_code == 409
    other_room = save_room(env, theirs['id'])
    _, response = send_shot(env, theirs['id'], other_room, shot_id=shot_id)
    assert response.status_code == 409


def test_only_a_photo_or_video_is_taken(env):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    _, response = send_shot(env, visit['id'], room_id, filename='a.pdf', content_type='application/pdf')
    assert response.status_code == 400


def test_a_video_is_stored_whole_and_queued_for_processing(env):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    _, response = send_shot(
        env, visit['id'], room_id, filename='walk.mp4', content_type='video/mp4', kind='video',
    )
    assert response.status_code == 200, response.text
    assert env.storage.uploads[0]['optimize'] is False
    assert env.queued == [response.json()['file_id']]
    assert response.json()['is_video'] is True
    assert response.json()['url'].startswith('/api/files/video/')
    assert env.read == []


def test_renaming_a_room_refiles_its_photos(env):
    visit = start(env)
    room_id = save_room(env, visit['id'], name='Room 1')
    send_shot(env, visit['id'], room_id)
    save_room(env, visit['id'], room_id=room_id, name='Den', name_source='user', floor='B', floor_source='user')
    assert env.session.query(File).one().category == 'Basement · Den'


def test_moving_a_shot_refiles_it(env):
    visit = start(env)
    room_a = save_room(env, visit['id'], name='Kitchen')
    room_b = save_room(env, visit['id'], name='Bath')
    shot_id, _ = send_shot(env, visit['id'], room_a, kind='wall', wall='1')
    response = env.api.patch(
        f"/api/field-visits/{visit['id']}/shots/{shot_id}", json={'room_id': room_b, 'kind': 'demo', 'wall': None},
    )
    assert response.status_code == 200, response.text
    assert env.session.query(File).one().category == '1st floor · Bath'
    assert response.json()['room_id'] == room_b
    assert response.json()['kind'] == 'demo'
    assert response.json()['wall'] is None


def test_deleting_a_shot_can_be_repeated(env):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    shot_id, _ = send_shot(env, visit['id'], room_id)
    url = f"/api/field-visits/{visit['id']}/shots/{shot_id}"
    assert env.api.delete(url).status_code == 200
    assert env.api.delete(url).status_code == 200
    assert detail(env, visit['id'])['shots'] == []
    env.session.expire_all()
    assert env.session.query(File).one().is_active is False


def test_a_file_deleted_from_a_gallery_leaves_the_visit(env):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    send_shot(env, visit['id'], room_id)
    env.session.query(File).update({File.is_active: False})
    env.session.commit()
    assert detail(env, visit['id'])['shots'] == []


# ── Reading rooms from photos ───────────────────────────────────────────────


def test_only_a_rooms_first_photo_or_a_move_is_read(env):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    first, _ = send_shot(env, visit['id'], room_id, first_photo='true')
    send_shot(env, visit['id'], room_id)
    moved, _ = send_shot(env, visit['id'], room_id, moved='true', steps='30')
    assert env.read == [first, moved]


def test_a_room_already_known_is_not_read_again_until_someone_moves(env):
    visit = start(env)
    room_id = save_room(env, visit['id'], name='Kitchen', name_source='user', room_type='kitchen')
    send_shot(env, visit['id'], room_id, first_photo='true')
    assert env.read == []


def _shot(env, visit_id, room_id):
    shot_id, response = send_shot(env, visit_id, room_id)
    assert response.status_code == 200
    return env.session.query(FieldShot).filter(FieldShot.id == shot_id).one()


def test_the_ai_names_an_unnamed_room_and_refiles_it(env):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    shot = _shot(env, visit['id'], room_id)
    room_reader.apply_reading(env.session, shot, {'room': 'kitchen', 'basement': False, 'confident': True})
    env.session.commit()
    room = env.session.query(FieldRoom).one()
    assert (room.name, room.name_source, room.room_type) == ('Kitchen', 'ai', 'kitchen')
    env.session.expire_all()
    assert env.session.query(File).one().category == '1st floor · Kitchen'


def test_a_second_bedroom_gets_a_number(env):
    visit = start(env)
    save_room(env, visit['id'], name='Bedroom', name_source='ai', room_type='bedroom')
    room_id = save_room(env, visit['id'], name='Room 2')
    shot = _shot(env, visit['id'], room_id)
    room_reader.apply_reading(env.session, shot, {'room': 'bedroom', 'basement': False, 'confident': True})
    assert shot.room.name == 'Bedroom 2'


def test_a_name_someone_chose_stays(env):
    visit = start(env)
    room_id = save_room(env, visit['id'], name="Mom's room", name_source='user')
    shot = _shot(env, visit['id'], room_id)
    room_reader.apply_reading(env.session, shot, {'room': 'bedroom', 'basement': False, 'confident': True})
    assert shot.room.name == "Mom's room"
    assert shot.room.room_type == 'bedroom'


def test_an_unsure_reading_changes_nothing(env):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    shot = _shot(env, visit['id'], room_id)
    room_reader.apply_reading(env.session, shot, {'room': 'kitchen', 'basement': True, 'confident': False})
    assert shot.room.name == 'Room 1'
    assert shot.ai_room_type is None
    assert shot.room.floor == '1'


def test_a_different_room_after_moving_is_only_noted_on_the_shot(env):
    visit = start(env)
    room_id = save_room(env, visit['id'], name='Kitchen', name_source='user', room_type='kitchen')
    shot = _shot(env, visit['id'], room_id)
    room_reader.apply_reading(env.session, shot, {'room': 'bathroom', 'basement': False, 'confident': True})
    assert shot.ai_room_type == 'bathroom'
    assert (shot.room.name, shot.room.room_type) == ('Kitchen', 'kitchen')


def test_a_basement_reading_sets_the_floor_unless_someone_picked_it(env):
    visit = start(env)
    guessed = save_room(env, visit['id'], name='Room 1', floor='1', floor_source='altitude')
    picked = save_room(env, visit['id'], name='Room 2', floor='2', floor_source='user')
    reading = {'room': 'utility', 'basement': True, 'confident': True}
    shot = _shot(env, visit['id'], guessed)
    room_reader.apply_reading(env.session, shot, reading)
    assert (shot.room.floor, shot.room.floor_source) == ('B', 'ai')
    shot = _shot(env, visit['id'], picked)
    room_reader.apply_reading(env.session, shot, reading)
    assert shot.room.floor == '2'


def test_a_phone_that_has_not_heard_the_ai_does_not_undo_it(env):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    shot = _shot(env, visit['id'], room_id)
    room_reader.apply_reading(env.session, shot, {'room': 'utility', 'basement': True, 'confident': True})
    env.session.commit()
    # The phone saves the room again with what it still has
    save_room(env, visit['id'], room_id=room_id, name='Room 1', name_source='default', floor='1', floor_source='altitude')
    env.session.expire_all()
    room = env.session.query(FieldRoom).one()
    assert (room.name, room.floor) == ('Utility', 'B')
    # Someone choosing does overrule it
    save_room(env, visit['id'], room_id=room_id, name='Shop', name_source='user', floor='1', floor_source='user')
    env.session.expire_all()
    room = env.session.query(FieldRoom).one()
    assert (room.name, room.floor) == ('Shop', '1')


def test_reading_saves_through_its_own_session(env, monkeypatch):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    shot = _shot(env, visit['id'], room_id)

    async def answer(_):
        return {'room': 'garage', 'basement': False, 'confident': True}

    monkeypatch.setattr(room_reader, '_ask', answer)
    room_reader.read_room_of_shot(shot.id, JPEG)
    env.session.expire_all()
    assert env.session.query(FieldRoom).one().name == 'Garage'


def test_a_failed_reading_leaves_the_room_alone(env, monkeypatch):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    shot = _shot(env, visit['id'], room_id)

    async def fail(_):
        raise ValueError('no provider')

    monkeypatch.setattr(room_reader, '_ask', fail)
    room_reader.read_room_of_shot(shot.id, JPEG)
    env.session.expire_all()
    assert env.session.query(FieldRoom).one().name == 'Room 1'


# ── A claim ─────────────────────────────────────────────────────────────────


def test_putting_a_visit_on_a_claim_moves_its_photos_there_and_back(env):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    send_shot(env, visit['id'], room_id)
    claim = Claim(client_id=visit['client_id'], claim_number='CL-1', status='open', company_id=env.bethany_id)
    env.session.add(claim)
    env.session.commit()

    env.who['staff'] = env.admin
    response = env.api.put(f"/api/field-visits/{visit['id']}/claim", json={'claim_id': str(claim.id)})
    assert response.status_code == 200, response.text
    env.session.expire_all()
    row = env.session.query(File).one()
    assert (row.context, row.context_id) == ('claim', str(claim.id))

    # A photo taken after it goes straight to the claim
    send_shot(env, visit['id'], room_id)
    assert env.storage.uploads[-1]['context'] == 'claim'
    env.session.expire_all()
    assert {f.context for f in env.session.query(File).all()} == {'claim'}

    env.api.put(f"/api/field-visits/{visit['id']}/claim", json={'claim_id': None})
    env.session.expire_all()
    assert {(f.context, f.context_id) for f in env.session.query(File).all()} == {('field-visit', visit['id'])}


def test_only_claims_someone_may_see_are_listed(env):
    visit = start(env)
    ours = Claim(client_id=visit['client_id'], claim_number='OURS', status='open')
    theirs = Claim(client_id=visit['client_id'], claim_number='THEIRS', status='open')
    env.session.add(ours)
    env.session.add(theirs)
    env.session.flush()
    env.session.add(ClaimCompany(claim_id=ours.id, company_id=env.bethany_id, role='contractor'))
    env.session.add(ClaimCompany(claim_id=theirs.id, company_id=env.rival_id, role='contractor'))
    env.session.commit()
    assert [c['claim_number'] for c in detail(env, visit['id'])['claims']] == ['OURS']
    response = env.api.put(f"/api/field-visits/{visit['id']}/claim", json={'claim_id': str(theirs.id)})
    assert response.status_code == 404
    env.who['staff'] = env.admin
    assert {c['claim_number'] for c in detail(env, visit['id'])['claims']} == {'OURS', 'THEIRS'}


def test_a_visit_can_not_go_on_another_clients_claim(env):
    visit = start(env)
    other = Client(display_name='Pat', owners=[], address='9 Oak', is_active=True)
    env.session.add(other)
    env.session.flush()
    claim = Claim(client_id=other.id, claim_number='CL-2', status='open')
    env.session.add(claim)
    env.session.commit()
    env.who['staff'] = env.admin
    response = env.api.put(f"/api/field-visits/{visit['id']}/claim", json={'claim_id': str(claim.id)})
    assert response.status_code == 400


# ── Whose visit it is ───────────────────────────────────────────────────────


def shared_client(env):
    """A Bethany client with a claim Rival works too, so both companies see it"""
    client = Client(display_name='Pat', owners=[], address='9 Oak', company_id=env.bethany_id, is_active=True)
    env.session.add(client)
    env.session.flush()
    claim = Claim(client_id=client.id, claim_number='CL-9', status='open')
    env.session.add(claim)
    env.session.flush()
    env.session.add(ClaimCompany(claim_id=claim.id, company_id=env.rival_id, role='contractor'))
    env.session.commit()
    return str(client.id)


def start_for(env, client_id, **extra):
    response = env.api.post('/api/field-visits/', json={'client_id': client_id, **extra})
    assert response.status_code == 200, response.text
    return response.json()


def test_a_visit_is_its_companys(env):
    visit = start(env)
    assert str(env.session.query(FieldVisit).one().company_id) == env.bethany_id
    assert detail(env, visit['id'])['id'] == visit['id']


def test_each_company_sees_only_its_own_visits_to_a_shared_client(env):
    client_id = shared_client(env)
    ours = start_for(env, client_id)
    room_id = save_room(env, ours['id'])
    send_shot(env, ours['id'], room_id)

    env.who['staff'] = env.outsider
    # The client is theirs to see too, but not our visit: they start their own
    theirs = start_for(env, client_id)
    assert theirs['id'] != ours['id']
    assert theirs['resumed'] is False
    assert str(env.session.query(FieldVisit).filter(FieldVisit.id == theirs['id']).one().company_id) == env.rival_id
    assert [row['id'] for row in env.api.get('/api/field-visits/', params={'client_id': client_id}).json()['visits']] == [
        theirs['id'],
    ]

    env.who['staff'] = env.field
    assert [row['id'] for row in env.api.get('/api/field-visits/', params={'client_id': client_id}).json()['visits']] == [
        ours['id'],
    ]
    # Coming back carries on with our own visit, not theirs
    assert start_for(env, client_id)['id'] == ours['id']


def test_another_companys_visit_can_not_be_opened_or_changed(env):
    client_id = shared_client(env)
    visit = start_for(env, client_id)
    room_id = save_room(env, visit['id'])
    shot_id, _ = send_shot(env, visit['id'], room_id)

    env.who['staff'] = env.outsider
    base = f"/api/field-visits/{visit['id']}"
    assert env.api.get(base).status_code == 404
    assert env.api.put(f'{base}/rooms/{room_id}', json={'name': 'Mine', 'floor': '1'}).status_code == 404
    assert send_shot(env, visit['id'], room_id)[1].status_code == 404
    assert env.api.patch(f'{base}/shots/{shot_id}', json={'kind': 'demo'}).status_code == 404
    assert env.api.delete(f'{base}/shots/{shot_id}').status_code == 404
    assert env.api.put(f'{base}/claim', json={'claim_id': None}).status_code == 404

    env.session.expire_all()
    assert env.session.query(FieldRoom).one().name == 'Room 1'
    assert env.session.query(FieldShot).one().kind == 'wall'
    assert env.session.query(File).one().is_active is True


def test_an_admin_sees_and_changes_every_companys_visits(env):
    client_id = shared_client(env)
    ours = start_for(env, client_id)
    env.who['staff'] = env.outsider
    theirs = start_for(env, client_id)

    env.who['staff'] = env.admin
    listed = {row['id'] for row in env.api.get('/api/field-visits/', params={'client_id': client_id}).json()['visits']}
    assert listed == {ours['id'], theirs['id']}
    for visit in (ours, theirs):
        assert detail(env, visit['id'])['id'] == visit['id']
        save_room(env, visit['id'], name='Kitchen')


def test_an_admins_visit_goes_to_the_company_working_the_client(env):
    client_id = shared_client(env)
    env.who['staff'] = env.admin
    visit = start_for(env, client_id)
    assert str(env.session.query(FieldVisit).one().company_id) == env.bethany_id
    # So that company's people carry on with it
    env.who['staff'] = env.field
    assert detail(env, visit['id'])['id'] == visit['id']
    env.who['staff'] = env.outsider
    assert env.api.get(f"/api/field-visits/{visit['id']}").status_code == 404


def test_an_admins_new_client_visit_goes_to_the_company_picked(env):
    env.who['staff'] = env.admin
    visit = start(env, company_id=env.rival_id)
    row = env.session.query(FieldVisit).one()
    assert str(row.company_id) == env.rival_id
    env.who['staff'] = env.outsider
    assert detail(env, visit['id'])['id'] == visit['id']


def test_someone_in_two_companies_works_under_the_one_on_the_client(env):
    env.session.add(StaffCompany(staff_id=env.outsider.id, company_id=env.bethany_id))
    env.session.commit()
    client = Client(display_name='Pat', owners=[], address='9 Oak', company_id=env.bethany_id, is_active=True)
    env.session.add(client)
    env.session.commit()
    env.who['staff'] = env.outsider
    # Rival is picked by default on the form, but the client is Bethany's
    visit = start_for(env, str(client.id), company_id=env.rival_id)
    assert str(env.session.query(FieldVisit).filter(FieldVisit.id == visit['id']).one().company_id) == env.bethany_id
    env.who['staff'] = env.field
    assert detail(env, visit['id'])['id'] == visit['id']


def test_a_visit_stays_its_companys_after_the_client_goes_to_another(env):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    shot_id, _ = send_shot(env, visit['id'], room_id)
    assert detail(env, visit['id'])['client_open'] is True

    client = env.session.query(Client).one()
    client.company_id = env.rival_id
    env.session.commit()

    # Still ours to see and change, though the client no longer is
    found = detail(env, visit['id'])
    assert found['client_open'] is False
    assert [shot['id'] for shot in found['shots']] == [shot_id]
    assert [row['id'] for row in env.api.get('/api/field-visits/').json()['visits']] == [visit['id']]
    save_room(env, visit['id'], room_id, name='Kitchen', name_source='user')
    assert send_shot(env, visit['id'], room_id)[1].status_code == 200
    assert env.api.delete(f"/api/field-visits/{visit['id']}/shots/{shot_id}").status_code == 200
    # A new visit there needs the client, which is the other company's now
    assert env.api.post('/api/field-visits/', json={'client_id': str(client.id)}).status_code == 404

    # Its new company sees the client, not our visit
    env.who['staff'] = env.outsider
    assert env.api.get(f"/api/field-visits/{visit['id']}").status_code == 404


def test_a_visit_on_a_claim_someone_is_off_stays_on_it(env):
    visit = start(env)
    room_id = save_room(env, visit['id'])
    send_shot(env, visit['id'], room_id)
    claim = Claim(client_id=visit['client_id'], claim_number='CL-3', status='open')
    env.session.add(claim)
    env.session.flush()
    env.session.add(ClaimCompany(claim_id=claim.id, company_id=env.rival_id, role='contractor'))
    env.session.commit()
    env.who['staff'] = env.admin
    assert env.api.put(f"/api/field-visits/{visit['id']}/claim", json={'claim_id': str(claim.id)}).status_code == 200

    # Ours to see, but its photos are Rival's claim's now, and only its people take them off
    env.who['staff'] = env.field
    assert detail(env, visit['id'])['claim_id'] == str(claim.id)
    assert env.api.put(f"/api/field-visits/{visit['id']}/claim", json={'claim_id': None}).status_code == 403
    env.session.expire_all()
    assert {f.context for f in env.session.query(File).all()} == {'claim'}


def test_a_visit_with_no_company_is_the_admins_alone(env):
    visit = start(env)
    row = env.session.query(FieldVisit).one()
    row.company_id = None
    env.session.commit()
    assert env.api.get(f"/api/field-visits/{visit['id']}").status_code == 404
    assert env.api.get('/api/field-visits/').json()['visits'] == []
    env.who['staff'] = env.admin
    assert detail(env, visit['id'])['id'] == visit['id']


def test_existing_visits_go_to_the_company_of_whoever_took_them(env):
    import importlib.util

    path = Path(__file__).resolve().parents[1] / 'alembic' / 'versions' / 'fv20261106co01_field_visit_company.py'
    spec = importlib.util.spec_from_file_location('_fv_company_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    client_id = shared_client(env)
    lonely = Client(display_name='Lee', owners=[], address='1 Pine', company_id=env.rival_id, is_active=True)
    env.session.add(lonely)
    env.session.commit()
    rows = {
        'field on shared': FieldVisit(client_id=client_id, created_by_id=env.field.id),
        'outsider on shared': FieldVisit(client_id=client_id, created_by_id=env.outsider.id),
        'admin on shared': FieldVisit(client_id=client_id, created_by_id=env.admin.id),
        'field on lonely': FieldVisit(client_id=lonely.id, created_by_id=env.field.id),
        'nobody on lonely': FieldVisit(client_id=lonely.id, created_by_id=None),
    }
    for row in rows.values():
        env.session.add(row)
    env.session.commit()

    with env.database.engine.begin() as conn:
        migration._backfill(conn)
    env.session.expire_all()
    assert {name: str(row.company_id) for name, row in rows.items()} == {
        'field on shared': env.bethany_id,
        'outsider on shared': env.rival_id,
        'admin on shared': env.bethany_id,
        # Someone not working the client keeps the visit in their own company
        'field on lonely': env.bethany_id,
        'nobody on lonely': env.rival_id,
    }


# ── The address here ────────────────────────────────────────────────────────


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        pass

    def json(self):
        return self.body


NOMINATIM = {
    'address': {
        'house_number': '10426', 'road': 'Main Street', 'city': 'Fairfax', 'state': 'Virginia',
        'ISO3166-2-lvl4': 'US-VA', 'postcode': '22030-1234', 'country_code': 'us',
    },
}


@pytest.fixture
def lookup(monkeypatch):
    geocode._cache.clear()
    calls = []

    def fake_get(url, params, headers, timeout):
        calls.append((params, headers))
        return FakeResponse(NOMINATIM)

    monkeypatch.setattr(geocode.httpx, 'get', fake_get)
    monkeypatch.setattr(geocode, '_MIN_SECONDS_APART', 0)
    monkeypatch.setattr(geocode.settings, 'NOMINATIM_REVERSE_ENABLED', True)
    return calls


def test_an_address_comes_back_in_our_fields(lookup):
    assert geocode.reverse_geocode(38.8462, -77.3064) == {
        'street': '10426 Main Street', 'has_number': True, 'city': 'Fairfax', 'state': 'VA', 'zipcode': '22030',
    }
    # The policy wants the application named, not a library's default
    assert 'SimpleWorks' in lookup[0][1]['User-Agent']


def test_a_road_with_no_number_says_so(monkeypatch, lookup):
    monkeypatch.setattr(geocode.httpx, 'get', lambda *a, **k: FakeResponse({
        'address': {'road': 'South Coast Drive', 'city': 'Costa Mesa', 'ISO3166-2-lvl4': 'US-CA', 'postcode': '92626'},
    }))
    found = geocode.reverse_geocode(33.689, -117.9)
    assert found['street'] == 'South Coast Drive'
    assert found['has_number'] is False


def test_nowhere_on_a_road_is_no_address(monkeypatch, lookup):
    monkeypatch.setattr(geocode.httpx, 'get', lambda *a, **k: FakeResponse({'address': {'state': 'Nevada'}}))
    assert geocode.reverse_geocode(39.0, -117.0) is None


def test_the_same_spot_is_only_asked_once(lookup):
    geocode.reverse_geocode(38.8462, -77.3064)
    geocode.reverse_geocode(38.846201, -77.306401)
    assert len(lookup) == 1


def test_it_can_be_switched_off(monkeypatch, lookup):
    monkeypatch.setattr(geocode.settings, 'NOMINATIM_REVERSE_ENABLED', False)
    assert geocode.reverse_geocode(38.8462, -77.3064) is None
    assert lookup == []


def test_a_failed_lookup_is_not_remembered(monkeypatch, lookup):
    def boom(*_, **__):
        raise geocode.httpx.ConnectError('down')

    monkeypatch.setattr(geocode.httpx, 'get', boom)
    assert geocode.reverse_geocode(38.8462, -77.3064) is None
    assert geocode._cache == {}


def test_the_screen_is_told_when_there_is_no_address(env, monkeypatch):
    monkeypatch.setattr(field_api, 'reverse_geocode', lambda lat, lng: None)
    response = env.api.get('/api/field-visits/reverse-geocode', params={'lat': 38.8, 'lng': -77.3})
    assert response.status_code == 503
    assert env.api.get('/api/field-visits/reverse-geocode', params={'lat': 99, 'lng': 0}).status_code == 422
