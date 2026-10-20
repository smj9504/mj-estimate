"""
Conversations between staff: who is in them, what was said and what each
person hasn't read yet.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import and_, func, or_, select

from app.domains.messaging.models import Conversation, ConversationParticipant, Message
from app.domains.staff.models import Staff

# Membership changes are shown in the conversation but don't count as unread
UNCOUNTED_KINDS = ('notice',)


class ConversationNotFound(Exception):
    """No such conversation, or the person isn't in it"""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: Optional[datetime]) -> Optional[str]:
    """ISO time in UTC; SQLite hands back naive times that are already UTC"""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError(f"Not a valid time: {value}")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


class MessagingService:
    def __init__(self, db: Any):
        self.db = db

    # People

    def people(self) -> List[Dict[str, Any]]:
        """Everyone who can sign in, for picking whom to message"""
        rows = self.db.query(Staff).filter(
            Staff.is_active.is_(True), Staff.can_login.is_(True)
        ).order_by(Staff.first_name, Staff.last_name).all()
        return [
            {
                'id': str(s.id),
                'name': s.full_name,
                'role': s.role.value if s.role else None,
                'job_title': s.job_title,
            }
            for s in rows
        ]

    def names(self, staff_ids: Iterable[Any]) -> Dict[str, str]:
        ids = {str(i) for i in staff_ids if i}
        if not ids:
            return {}
        rows = self.db.query(Staff.id, Staff.first_name, Staff.last_name).filter(Staff.id.in_(ids)).all()
        return {str(r.id): f"{r.first_name} {r.last_name}".strip() for r in rows}

    def require_active_staff(self, staff_ids: Iterable[str]) -> List[str]:
        """The ids, checked to be people who can sign in"""
        ids = {str(i) for i in staff_ids}
        found = {
            str(r.id) for r in self.db.query(Staff.id).filter(
                Staff.id.in_(ids), Staff.is_active.is_(True), Staff.can_login.is_(True)
            ).all()
        } if ids else set()
        missing = ids - found
        if missing:
            raise ValueError("Some of the people picked can't receive messages")
        return sorted(ids)

    # Conversations

    def membership(self, conversation_id: str, staff_id: Any) -> Optional[ConversationParticipant]:
        return self.db.query(ConversationParticipant).filter(
            ConversationParticipant.conversation_id == str(conversation_id),
            ConversationParticipant.staff_id == str(staff_id),
        ).first()

    def require_conversation(self, conversation_id: str, staff_id: Any) -> Conversation:
        try:
            member = self.membership(conversation_id, staff_id)
        except ValueError:  # not a UUID
            member = None
        if member is None:
            raise ConversationNotFound()
        return member.conversation

    def member_ids(self, conversation_id: Any) -> List[str]:
        return [
            str(r.staff_id) for r in self.db.query(ConversationParticipant.staff_id).filter(
                ConversationParticipant.conversation_id == str(conversation_id)
            ).all()
        ]

    def direct_conversation(self, a_id: Any, b_id: Any) -> Conversation:
        """The one-to-one conversation between two people, started if needed"""
        a_id, b_id = str(a_id), str(b_id)
        P = ConversationParticipant
        mine = select(P.conversation_id).where(P.staff_id == a_id)
        found = self.db.query(Conversation).join(P, P.conversation_id == Conversation.id).filter(
            Conversation.is_group.is_(False),
            P.staff_id == b_id,
            Conversation.id.in_(mine),
        ).first()
        if found:
            return found
        return self._create(a_id, [a_id, b_id], title=None, is_group=False)

    def start(self, staff: Any, participant_ids: Iterable[str], title: Optional[str] = None) -> Conversation:
        """Open a conversation with others: one-to-one with one person and no
        name, otherwise a group"""
        me = str(staff.id)
        others = self.require_active_staff(set(map(str, participant_ids)) - {me})
        if not others:
            raise ValueError("Pick at least one other person")
        title = (title or '').strip() or None
        if len(others) == 1 and not title:
            return self.direct_conversation(me, others[0])
        return self._create(me, [me] + others, title=title, is_group=True)

    def _create(self, creator_id: str, member_ids: List[str], title: Optional[str], is_group: bool) -> Conversation:
        conversation = Conversation(title=title, is_group=is_group, created_by_id=creator_id)
        self.db.add(conversation)
        self.db.flush()
        for staff_id in dict.fromkeys(member_ids):
            self.db.add(ConversationParticipant(conversation_id=conversation.id, staff_id=staff_id))
        self.db.flush()
        return conversation

    def rename(self, conversation: Conversation, staff: Any, title: str) -> None:
        if not conversation.is_group:
            raise ValueError("Only a group can be renamed")
        title = (title or '').strip()
        if not title:
            raise ValueError("Give the group a name")
        conversation.title = title
        self.post(conversation, staff.id, f"{self._name(staff)} renamed the group to {title}", kind='notice')

    def add_members(self, conversation: Conversation, staff: Any, staff_ids: Iterable[str]) -> None:
        if not conversation.is_group:
            raise ValueError("People can only be added to a group; start a new group instead")
        current = set(self.member_ids(conversation.id))
        new_ids = [i for i in self.require_active_staff(staff_ids) if i not in current]
        if not new_ids:
            return
        now = utcnow()
        for staff_id in new_ids:
            # They can read the history, but it isn't new to them
            self.db.add(ConversationParticipant(
                conversation_id=conversation.id, staff_id=staff_id, last_read_at=now
            ))
        self.db.flush()
        names = self.names(new_ids)
        added = ', '.join(names.get(i, 'someone') for i in new_ids)
        self.post(conversation, staff.id, f"{self._name(staff)} added {added}", kind='notice')

    def leave(self, conversation: Conversation, staff: Any) -> None:
        if not conversation.is_group:
            raise ValueError("Only a group can be left")
        member = self.membership(conversation.id, staff.id)
        if member is None:
            raise ConversationNotFound()
        self.db.delete(member)
        self.db.flush()
        if not self.member_ids(conversation.id):
            self.db.delete(conversation)
            self.db.flush()
            return
        self.post(conversation, staff.id, f"{self._name(staff)} left the group", kind='notice')

    # Messages

    def post(
        self,
        conversation: Conversation,
        sender_id: Any,
        body: str,
        kind: str = 'text',
        related_type: Optional[str] = None,
        related_id: Any = None,
    ) -> Message:
        body = (body or '').strip()
        if not body:
            raise ValueError("A message can't be empty")
        now = utcnow()
        message = Message(
            conversation_id=conversation.id,
            sender_id=str(sender_id) if sender_id else None,
            kind=kind,
            body=body,
            related_type=related_type,
            related_id=str(related_id) if related_id else None,
            created_at=now,
        )
        self.db.add(message)
        conversation.last_message_at = now
        # What you write yourself is already read
        if sender_id:
            member = self.membership(conversation.id, sender_id)
            if member is not None:
                member.last_read_at = now
        self.db.flush()
        return message

    def mark_read(self, conversation_id: Any, staff_id: Any) -> None:
        member = self.membership(conversation_id, staff_id)
        if member is not None:
            member.last_read_at = utcnow()
            self.db.flush()

    def messages(
        self,
        conversation_id: Any,
        before: Optional[datetime] = None,
        after: Optional[datetime] = None,
        limit: int = 50,
    ) -> List[Message]:
        """Oldest first. With `after`, only what came since; otherwise the
        latest `limit` (before `before`, when given)."""
        query = self.db.query(Message).filter(Message.conversation_id == str(conversation_id))
        if after is not None:
            return query.filter(Message.created_at > after).order_by(Message.created_at).limit(limit).all()
        if before is not None:
            query = query.filter(Message.created_at < before)
        latest = query.order_by(Message.created_at.desc()).limit(limit).all()
        return list(reversed(latest))

    def unread_counts(self, staff_id: Any) -> Dict[str, int]:
        """Unread messages per conversation for this person"""
        staff_id = str(staff_id)
        P = ConversationParticipant
        rows = self.db.query(Message.conversation_id, func.count(Message.id)).join(
            P, and_(P.conversation_id == Message.conversation_id, P.staff_id == staff_id)
        ).filter(
            or_(Message.sender_id.is_(None), Message.sender_id != staff_id),
            Message.kind.notin_(UNCOUNTED_KINDS),
            or_(P.last_read_at.is_(None), Message.created_at > P.last_read_at),
        ).group_by(Message.conversation_id).all()
        return {str(cid): count for cid, count in rows}

    def unread_total(self, staff_id: Any) -> int:
        return sum(self.unread_counts(staff_id).values())

    def inbox(self, staff_id: Any) -> List[Dict[str, Any]]:
        """This person's conversations, most recent first"""
        staff_id = str(staff_id)
        P = ConversationParticipant
        conversations = self.db.query(Conversation).join(P, P.conversation_id == Conversation.id).filter(
            P.staff_id == staff_id
        ).all()
        if not conversations:
            return []
        ids = [str(c.id) for c in conversations]

        members: Dict[str, List[str]] = {}
        for cid, sid in self.db.query(P.conversation_id, P.staff_id).filter(P.conversation_id.in_(ids)).all():
            members.setdefault(str(cid), []).append(str(sid))

        newest = self.db.query(
            Message.conversation_id, func.max(Message.created_at).label('at')
        ).filter(Message.conversation_id.in_(ids)).group_by(Message.conversation_id).subquery()
        last_messages = {
            str(m.conversation_id): m for m in self.db.query(Message).join(
                newest, and_(Message.conversation_id == newest.c.conversation_id, Message.created_at == newest.c.at)
            ).all()
        }

        everyone = {sid for sids in members.values() for sid in sids}
        everyone |= {str(m.sender_id) for m in last_messages.values() if m.sender_id}
        names = self.names(everyone)
        unread = self.unread_counts(staff_id)

        summaries = [
            self.conversation_summary(c, staff_id, members.get(str(c.id), []), names,
                                      last_messages.get(str(c.id)), unread.get(str(c.id), 0))
            for c in conversations
        ]
        summaries.sort(key=lambda s: s['last_message_at'] or s['created_at'] or '', reverse=True)
        return summaries

    def conversation_summary(
        self,
        conversation: Conversation,
        viewer_id: str,
        member_ids: List[str],
        names: Dict[str, str],
        last_message: Optional[Message] = None,
        unread_count: int = 0,
    ) -> Dict[str, Any]:
        others = [i for i in member_ids if i != str(viewer_id)]
        if conversation.is_group:
            display_name = conversation.title or ', '.join(names.get(i, 'Someone') for i in others[:3]) or 'Group'
        else:
            display_name = names.get(others[0], 'Someone') if others else 'Just you'
        return {
            'id': str(conversation.id),
            'title': conversation.title,
            'is_group': bool(conversation.is_group),
            'display_name': display_name,
            'participants': [{'id': i, 'name': names.get(i, 'Someone')} for i in member_ids],
            'last_message': self.message_dict(last_message, names) if last_message else None,
            'last_message_at': iso(conversation.last_message_at),
            'created_at': iso(conversation.created_at),
            'unread_count': unread_count,
        }

    def message_dict(self, message: Message, names: Dict[str, str]) -> Dict[str, Any]:
        sender_id = str(message.sender_id) if message.sender_id else None
        return {
            'id': str(message.id),
            'conversation_id': str(message.conversation_id),
            'sender_id': sender_id,
            'sender_name': names.get(sender_id) if sender_id else None,
            'kind': message.kind,
            'body': message.body,
            'related_type': message.related_type,
            'related_id': str(message.related_id) if message.related_id else None,
            'created_at': iso(message.created_at),
        }

    def _name(self, staff: Any) -> str:
        return getattr(staff, 'full_name', None) or self.names([staff.id]).get(str(staff.id), 'Someone')
