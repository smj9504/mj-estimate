"""
Authentication service layer
"""
from datetime import datetime, timedelta
from typing import Optional, Union
from uuid import UUID
import bcrypt
import jwt
from sqlalchemy.orm import Session
from app.core.database_factory import DatabaseSession
from sqlalchemy.exc import IntegrityError
import uuid

from app.domains.staff.models import Staff, StaffRole
from . import schemas
from app.core.config import settings


class AuthService:
    SECRET_KEY = settings.SECRET_KEY
    ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours
    
    @staticmethod
    def hash_password(password: str) -> str:
        """Hash a password using bcrypt"""
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        return hashed.decode('utf-8')
    
    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a password against its hash"""
        return bcrypt.checkpw(
            plain_password.encode('utf-8'),
            hashed_password.encode('utf-8')
        )
    
    @staticmethod
    def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
        """Create a JWT access token"""
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=AuthService.ACCESS_TOKEN_EXPIRE_MINUTES)
        
        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, AuthService.SECRET_KEY, algorithm=AuthService.ALGORITHM)
        return encoded_jwt
    
    @staticmethod
    def decode_token(token: str) -> Optional[schemas.TokenData]:
        """Decode and validate a JWT token"""
        try:
            payload = jwt.decode(token, AuthService.SECRET_KEY, algorithms=[AuthService.ALGORITHM])
            user_id = payload.get("sub")
            username = payload.get("username")
            role = payload.get("role")
            company_id = payload.get("company_id")
            
            if user_id is None:
                return None
                
            return schemas.TokenData(
                user_id=user_id,
                username=username,
                role=role,
                company_id=company_id
            )
        except jwt.ExpiredSignatureError:
            return None
        except jwt.PyJWTError:
            return None
    
    def create_staff(self, db, staff_create: schemas.StaffCreate) -> Staff:
        """Create a new staff member"""
        hashed_password = self.hash_password(staff_create.password)
        
        db_staff = Staff(
            username=staff_create.username,
            email=staff_create.email,
            first_name=staff_create.first_name,
            last_name=staff_create.last_name,
            password_hash=hashed_password,
            role=staff_create.role,
            hire_date=staff_create.hire_date or datetime.utcnow(),
            staff_number=staff_create.staff_number
        )
        
        try:
            # Handle both raw Session and DatabaseSession wrapper
            if hasattr(db, '_session'):
                session = db._session
            else:
                session = db
            
            session.add(db_staff)
            session.commit()
            session.refresh(db_staff)
            return db_staff
        except IntegrityError:
            if hasattr(db, 'rollback'):
                db.rollback()
            raise ValueError("Username or email already exists")
    
    def authenticate_staff(self, db, username: str, password: str) -> Optional[Staff]:
        """Authenticate a staff member by username and password"""
        # Handle both raw Session and DatabaseSession wrapper
        if hasattr(db, '_session'):
            session = db._session
        elif hasattr(db, 'query'):
            session = db
        else:
            raise ValueError("Invalid database session type")
            
        staff = session.query(Staff).filter(
            (Staff.username == username) | (Staff.email == username)
        ).first()
        
        if not staff:
            return None
            
        if not staff.can_login or not staff.is_active:
            return None
            
        if not self.verify_password(password, staff.password_hash):
            return None
            
        # Update last login using a separate query to avoid session issues
        try:
            # Store the staff ID before any session operations
            staff_id = staff.id
            
            # Use a direct update query instead of modifying the object
            session.query(Staff).filter(Staff.id == staff_id).update(
                {"last_login": datetime.utcnow()},
                synchronize_session=False
            )
            
            # Commit the change
            if hasattr(db, 'commit'):
                db.commit()
            else:
                session.commit()
                
            # Re-query the staff object to get fresh data
            # This avoids the ObjectDeletedError from refresh
            staff = session.query(Staff).filter(Staff.id == staff_id).first()
        except Exception as e:
            # Log the error but don't fail the login
            print(f"Warning: Failed to update last_login: {e}")
            # Rollback if needed
            if hasattr(db, 'rollback'):
                db.rollback()
            elif hasattr(session, 'rollback'):
                session.rollback()
            # Re-query the staff object even if update failed
            staff = session.query(Staff).filter(Staff.id == staff_id).first()
        
        return staff
    
    def get_staff_by_id(self, db, staff_id: Union[str, UUID]) -> Optional[Staff]:
        """Get a staff member by ID"""
        # Handle both raw Session and DatabaseSession wrapper
        if hasattr(db, '_session'):
            session = db._session
        elif hasattr(db, 'query'):
            session = db
        else:
            return None
        
        # Convert string to UUID if needed
        if isinstance(staff_id, str):
            try:
                staff_id = uuid.UUID(staff_id)
            except (ValueError, TypeError):
                return None
            
        return session.query(Staff).filter(Staff.id == staff_id).first()
    
    def get_staff_by_username(self, db, username: str) -> Optional[Staff]:
        """Get a staff member by username"""
        # Handle both raw Session and DatabaseSession wrapper
        if hasattr(db, '_session'):
            session = db._session
        elif hasattr(db, 'query'):
            session = db
        else:
            return None
            
        return session.query(Staff).filter(Staff.username == username).first()
    
    def get_staff_by_email(self, db, email: str) -> Optional[Staff]:
        """Get a staff member by email"""
        # Handle both raw Session and DatabaseSession wrapper
        if hasattr(db, '_session'):
            session = db._session
        elif hasattr(db, 'query'):
            session = db
        else:
            return None
            
        return session.query(Staff).filter(Staff.email == email).first()
    
    def update_staff(self, db, staff_id: Union[str, UUID], staff_update: schemas.StaffUpdate) -> Optional[Staff]:
        """Update a staff member"""
        staff = self.get_staff_by_id(db, staff_id)
        if not staff:
            return None
        
        # Handle both raw Session and DatabaseSession wrapper
        if hasattr(db, '_session'):
            session = db._session
        elif hasattr(db, 'query'):
            session = db
        else:
            raise ValueError("Invalid database session type")
        
        update_data = staff_update.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(staff, field, value)
        
        staff.updated_at = datetime.utcnow()
        
        # Use consistent session handling
        if hasattr(db, '_session'):
            # Ensure the staff object is merged into the session
            staff = session.merge(staff)
            session.flush()  # Flush to ensure the update is pending
            db.commit()  # Use the wrapper's commit method
            session.refresh(staff)
        else:
            # For raw sessions, use direct commit
            session.flush()  # Flush to ensure the update is pending
            session.commit()
            session.refresh(staff)
        
        return staff
    
    def change_password(self, db, staff_id: Union[str, UUID], current_password: str, new_password: str) -> bool:
        """Change a staff member's password"""
        staff = self.get_staff_by_id(db, staff_id)
        if not staff:
            return False
        
        if not self.verify_password(current_password, staff.password_hash):
            return False
        
        # Handle both raw Session and DatabaseSession wrapper
        if hasattr(db, '_session'):
            session = db._session
        elif hasattr(db, 'query'):
            session = db
        else:
            raise ValueError("Invalid database session type")
        
        staff.password_hash = self.hash_password(new_password)
        staff.updated_at = datetime.utcnow()
        staff.must_change_password = False
        
        # Use consistent session handling
        if hasattr(db, '_session'):
            # Ensure the staff object is merged into the session
            staff = session.merge(staff)
            session.flush()  # Flush to ensure the update is pending
            db.commit()  # Use the wrapper's commit method
        else:
            # For raw sessions, use direct commit
            session.flush()  # Flush to ensure the update is pending
            session.commit()
        
        return True
    
    def create_initial_admin(self, db) -> Optional[Staff]:
        """Create the initial admin staff member if none exists"""
        # Handle both raw Session and DatabaseSession wrapper
        if hasattr(db, '_session'):
            session = db._session
        elif hasattr(db, 'query'):
            session = db
        else:
            return None
            
        admin_exists = session.query(Staff).filter(Staff.role == StaffRole.admin).first()
        if admin_exists:
            return None
        
        admin_staff = schemas.StaffCreate(
            username="admin",
            email="admin@mjestimate.com",
            password="admin123",
            first_name="System",
            last_name="Administrator",
            role=StaffRole.admin,
            staff_number="ADMIN001"
        )
        
        return self.create_staff(db, admin_staff)