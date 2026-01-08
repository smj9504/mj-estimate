"""
Staff API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional
from uuid import UUID
from datetime import datetime

from .schemas import (
    Staff, StaffCreate, StaffUpdate, StaffResponse, StaffListResponse,
    StaffPermission, StaffPermissionCreate, StaffPermissionUpdate, StaffPermissionResponse,
    AuditLog, AuditLogResponse, StaffFilter, AuditLogFilter,
    LoginRequest, LoginResponse, ChangePasswordRequest,
    GoogleDriveSettingsUpdate, GoogleDriveSettingsResponse, GoogleDriveTestResponse,
    GoogleOAuthInitResponse, GoogleOAuthCallbackRequest, GoogleOAuthCallbackResponse,
    GoogleOAuthStatusResponse, GoogleDriveFolderListResponse, GoogleDriveFolderResponse,
    GoogleDriveFolderCreateRequest, GoogleDriveFolderSelectRequest
)
from .service import StaffService
from .models import StaffRole
from app.core.database_factory import get_database
from app.core.cache import get_cache, CacheService
from app.domains.auth.dependencies import invalidate_staff_cache

router = APIRouter()


def get_staff_service():
    """Dependency to get staff service"""
    return StaffService(get_database())


@router.post("/login", response_model=LoginResponse)
async def login(
    login_data: LoginRequest,
    service: StaffService = Depends(get_staff_service)
):
    """Staff login endpoint"""
    try:
        result = service.authenticate_staff(login_data.username, login_data.password)
        if not result:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Login failed: {str(e)}")


@router.post("/change-password")
async def change_password(
    password_data: ChangePasswordRequest,
    current_staff_id: UUID = Query(..., description="Current staff ID"),
    service: StaffService = Depends(get_staff_service)
):
    """Change staff password"""
    try:
        if password_data.new_password != password_data.confirm_password:
            raise HTTPException(status_code=400, detail="New passwords do not match")
        
        success = service.change_password(
            current_staff_id, 
            password_data.current_password, 
            password_data.new_password
        )
        
        if not success:
            raise HTTPException(status_code=400, detail="Failed to change password")
        
        return {"message": "Password changed successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Password change failed: {str(e)}")


@router.get("/", response_model=StaffListResponse)
async def get_staff_members(
    search: Optional[str] = Query(None, description="Search term"),
    role: Optional[StaffRole] = Query(None, description="Filter by role"),
    department: Optional[str] = Query(None, description="Filter by department"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    service: StaffService = Depends(get_staff_service)
):
    """Get all staff members with optional filters"""
    try:
        filters = StaffFilter(
            search=search,
            role=role,
            department=department,
            is_active=is_active,
            company_id=company_id
        )
        
        result = service.get_staff_with_filters(filters)
        staff_members = result.get('staff', [])
        
        return StaffListResponse(data=staff_members, total=len(staff_members))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving staff: {str(e)}")


@router.get("/{staff_id}", response_model=StaffResponse)
async def get_staff_member(
    staff_id: UUID,
    service: StaffService = Depends(get_staff_service)
):
    """Get single staff member by ID"""
    try:
        staff = service.get_by_id(staff_id)
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")
        return StaffResponse(data=staff)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving staff member: {str(e)}")


@router.post("/", response_model=StaffResponse)
async def create_staff_member(
    staff: StaffCreate,
    service: StaffService = Depends(get_staff_service)
):
    """Create new staff member"""
    try:
        new_staff = service.create_staff_member(staff)
        return StaffResponse(
            data=new_staff,
            message="Staff member created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error creating staff member: {str(e)}")


@router.put("/{staff_id}", response_model=StaffResponse)
async def update_staff_member(
    staff_id: UUID,
    staff: StaffUpdate,
    service: StaffService = Depends(get_staff_service),
    cache: CacheService = Depends(get_cache)
):
    """Update staff member"""
    try:
        update_data = staff.dict(exclude_none=True)
        updated_staff = service.update(staff_id, update_data)

        if not updated_staff:
            raise HTTPException(status_code=404, detail="Staff member not found")

        # Invalidate cache after successful update
        invalidate_staff_cache(str(staff_id), cache)

        return StaffResponse(
            data=updated_staff,
            message="Staff member updated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Update failed: {str(e)}")


@router.delete("/{staff_id}")
async def delete_staff_member(
    staff_id: UUID,
    service: StaffService = Depends(get_staff_service)
):
    """Delete staff member (soft delete)"""
    try:
        success = service.deactivate_staff_member(staff_id)
        if not success:
            raise HTTPException(status_code=404, detail="Staff member not found")
        return {"message": "Staff member deactivated successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error deactivating staff member: {str(e)}")


@router.get("/{staff_id}/permissions", response_model=StaffPermissionResponse)
async def get_staff_permissions(
    staff_id: UUID,
    service: StaffService = Depends(get_staff_service)
):
    """Get staff member permissions"""
    try:
        permissions = service.get_staff_permissions(staff_id)
        return StaffPermissionResponse(data=permissions)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving permissions: {str(e)}")


@router.put("/{staff_id}/permissions", response_model=StaffPermissionResponse)
async def update_staff_permissions(
    staff_id: UUID,
    permissions: StaffPermissionUpdate,
    service: StaffService = Depends(get_staff_service),
    cache: CacheService = Depends(get_cache)
):
    """Update staff member permissions"""
    try:
        updated_permissions = service.update_staff_permissions(staff_id, permissions)

        # Invalidate cache after permission changes
        invalidate_staff_cache(str(staff_id), cache)

        return StaffPermissionResponse(
            data=updated_permissions,
            message="Permissions updated successfully"
        )

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error updating permissions: {str(e)}")


@router.get("/audit-logs/", response_model=AuditLogResponse)
async def get_audit_logs(
    staff_id: Optional[UUID] = Query(None, description="Filter by staff ID"),
    action: Optional[str] = Query(None, description="Filter by action"),
    entity_type: Optional[str] = Query(None, description="Filter by entity type"),
    entity_id: Optional[UUID] = Query(None, description="Filter by entity ID"),
    success: Optional[bool] = Query(None, description="Filter by success status"),
    date_from: Optional[datetime] = Query(None, description="Filter from date"),
    date_to: Optional[datetime] = Query(None, description="Filter to date"),
    limit: int = Query(100, description="Limit results"),
    service: StaffService = Depends(get_staff_service)
):
    """Get audit logs with filters"""
    try:
        filters = AuditLogFilter(
            staff_id=staff_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            success=success,
            date_from=date_from,
            date_to=date_to
        )
        
        result = service.get_audit_logs(filters, limit)
        return AuditLogResponse(data=result, total=len(result))
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving audit logs: {str(e)}")


# Utility endpoints
@router.get("/roles/list")
async def get_staff_roles():
    """Get list of available staff roles"""
    return {
        "roles": [
            {"value": role.value, "label": role.value.replace("_", " ").title()}
            for role in StaffRole
        ]
    }


@router.get("/dashboard/stats")
async def get_staff_dashboard_stats(
    company_id: Optional[UUID] = Query(None, description="Filter by company ID"),
    service: StaffService = Depends(get_staff_service)
):
    """Get staff dashboard statistics"""
    try:
        stats = service.get_staff_dashboard_stats(company_id)
        return stats
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving staff stats: {str(e)}")


@router.post("/generate-number")
async def generate_staff_number(
    company_id: UUID = Query(..., description="Company ID"),
    service: StaffService = Depends(get_staff_service)
):
    """Generate a new staff number"""
    try:
        staff_number = service.generate_staff_number(company_id)
        return {"staff_number": staff_number}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating staff number: {str(e)}")


# ========== Google Drive Settings Endpoints ==========

@router.get("/{staff_id}/gdrive-settings", response_model=GoogleDriveSettingsResponse)
async def get_gdrive_settings(
    staff_id: UUID,
    service: StaffService = Depends(get_staff_service)
):
    """Get Google Drive settings for a staff member (excludes sensitive credentials)"""
    try:
        staff = service.get_by_id(staff_id)
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")

        return GoogleDriveSettingsResponse(
            gdrive_enabled=staff.get('gdrive_enabled', False),
            gdrive_root_folder_id=staff.get('gdrive_root_folder_id'),
            gdrive_configured=bool(staff.get('gdrive_service_account_json')),
            message="Settings retrieved successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving Google Drive settings: {str(e)}")


@router.put("/{staff_id}/gdrive-settings", response_model=GoogleDriveSettingsResponse)
async def update_gdrive_settings(
    staff_id: UUID,
    settings_data: GoogleDriveSettingsUpdate,
    service: StaffService = Depends(get_staff_service),
    cache: CacheService = Depends(get_cache)
):
    """Update Google Drive settings for a staff member"""
    from app.core.encryption import encrypt_text

    try:
        staff = service.get_by_id(staff_id)
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")

        update_data = {}

        # Encrypt service account JSON if provided
        if settings_data.gdrive_service_account_json is not None:
            if settings_data.gdrive_service_account_json:
                # Validate JSON format
                import json
                try:
                    json.loads(settings_data.gdrive_service_account_json)
                except json.JSONDecodeError:
                    raise HTTPException(status_code=400, detail="Invalid JSON format for service account key")

                # Encrypt and store
                update_data['gdrive_service_account_json'] = encrypt_text(settings_data.gdrive_service_account_json)
            else:
                # Clear the service account JSON
                update_data['gdrive_service_account_json'] = None

        if settings_data.gdrive_root_folder_id is not None:
            update_data['gdrive_root_folder_id'] = settings_data.gdrive_root_folder_id or None

        if settings_data.gdrive_enabled is not None:
            update_data['gdrive_enabled'] = settings_data.gdrive_enabled

        if update_data:
            updated_staff = service.update(staff_id, update_data)
            if not updated_staff:
                raise HTTPException(status_code=404, detail="Failed to update staff member")

            # Invalidate cache
            invalidate_staff_cache(str(staff_id), cache)

        # Return updated settings
        return GoogleDriveSettingsResponse(
            gdrive_enabled=update_data.get('gdrive_enabled', staff.get('gdrive_enabled', False)),
            gdrive_root_folder_id=update_data.get('gdrive_root_folder_id', staff.get('gdrive_root_folder_id')),
            gdrive_configured=bool(update_data.get('gdrive_service_account_json', staff.get('gdrive_service_account_json'))),
            message="Google Drive settings updated successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error updating Google Drive settings: {str(e)}")


@router.post("/{staff_id}/gdrive-settings/test", response_model=GoogleDriveTestResponse)
async def test_gdrive_connection(
    staff_id: UUID,
    service: StaffService = Depends(get_staff_service)
):
    """Test Google Drive connection with stored credentials"""
    from app.core.encryption import decrypt_text

    try:
        staff = service.get_by_id(staff_id)
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")

        encrypted_json = staff.get('gdrive_service_account_json')
        folder_id = staff.get('gdrive_root_folder_id')

        if not encrypted_json:
            return GoogleDriveTestResponse(
                success=False,
                message="Service account JSON is not configured"
            )

        if not folder_id:
            return GoogleDriveTestResponse(
                success=False,
                message="Root folder ID is not configured"
            )

        # Decrypt service account JSON
        try:
            service_account_json = decrypt_text(encrypted_json)
        except Exception:
            return GoogleDriveTestResponse(
                success=False,
                message="Failed to decrypt service account credentials"
            )

        # Test Google Drive connection
        try:
            import json
            from google.oauth2 import service_account
            from googleapiclient.discovery import build

            credentials_info = json.loads(service_account_json)
            credentials = service_account.Credentials.from_service_account_info(
                credentials_info,
                scopes=['https://www.googleapis.com/auth/drive']
            )

            drive_service = build('drive', 'v3', credentials=credentials)

            # Try to get folder info
            folder = drive_service.files().get(
                fileId=folder_id,
                fields='id, name, webViewLink'
            ).execute()

            return GoogleDriveTestResponse(
                success=True,
                message="Successfully connected to Google Drive",
                folder_name=folder.get('name'),
                folder_url=folder.get('webViewLink')
            )

        except Exception as e:
            return GoogleDriveTestResponse(
                success=False,
                message=f"Connection failed: {str(e)}"
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error testing Google Drive connection: {str(e)}")


# ========== Google OAuth 2.0 Endpoints ==========

@router.get("/{staff_id}/gdrive-oauth/status", response_model=GoogleOAuthStatusResponse)
async def get_gdrive_oauth_status(
    staff_id: UUID,
    service: StaffService = Depends(get_staff_service)
):
    """Get Google Drive OAuth connection status"""
    try:
        staff = service.get_by_id(staff_id)
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")

        # Check OAuth connection
        has_oauth = bool(staff.get('gdrive_oauth_refresh_token'))
        has_service_account = bool(staff.get('gdrive_service_account_json'))

        if has_oauth:
            auth_type = 'oauth'
            email = staff.get('gdrive_oauth_email')
            connected = True
        elif has_service_account:
            auth_type = 'service_account'
            email = None
            connected = True
        else:
            auth_type = 'none'
            email = None
            connected = False

        return GoogleOAuthStatusResponse(
            connected=connected,
            auth_type=auth_type,
            email=email,
            gdrive_enabled=staff.get('gdrive_enabled', False),
            gdrive_root_folder_id=staff.get('gdrive_root_folder_id'),
            message="Status retrieved successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting OAuth status: {str(e)}")


@router.post("/{staff_id}/gdrive-oauth/init", response_model=GoogleOAuthInitResponse)
async def init_gdrive_oauth(
    staff_id: UUID,
    service: StaffService = Depends(get_staff_service)
):
    """Initialize Google OAuth flow - returns authorization URL"""
    from .google_oauth_service import GoogleOAuthService
    import secrets

    try:
        staff = service.get_by_id(staff_id)
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")

        oauth_service = GoogleOAuthService()

        # Generate state parameter with staff_id for security
        state = f"{staff_id}:{secrets.token_urlsafe(32)}"

        authorization_url, returned_state = oauth_service.get_authorization_url(state=state)

        return GoogleOAuthInitResponse(
            authorization_url=authorization_url,
            state=returned_state
        )

    except ValueError as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error initializing OAuth: {type(e).__name__}: {str(e)}")


@router.post("/{staff_id}/gdrive-oauth/callback", response_model=GoogleOAuthCallbackResponse)
async def gdrive_oauth_callback(
    staff_id: UUID,
    callback_data: GoogleOAuthCallbackRequest,
    service: StaffService = Depends(get_staff_service),
    cache: CacheService = Depends(get_cache)
):
    """Handle OAuth callback - exchange code for tokens and save"""
    from .google_oauth_service import GoogleOAuthService, encrypt_tokens
    from app.core.encryption import encrypt_text

    try:
        staff = service.get_by_id(staff_id)
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")

        oauth_service = GoogleOAuthService()

        # Exchange authorization code for tokens
        tokens = oauth_service.exchange_code_for_tokens(callback_data.code)

        # Encrypt and prepare update data
        update_data = encrypt_tokens(tokens)
        update_data['gdrive_enabled'] = True

        # Clear legacy service account if switching to OAuth
        update_data['gdrive_service_account_json'] = None

        # Update staff record
        updated_staff = service.update(staff_id, update_data)
        if not updated_staff:
            raise HTTPException(status_code=500, detail="Failed to save OAuth tokens")

        # Invalidate cache
        invalidate_staff_cache(str(staff_id), cache)

        return GoogleOAuthCallbackResponse(
            success=True,
            message="Successfully connected to Google Drive",
            email=tokens.get('email')
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing OAuth callback: {str(e)}")


@router.post("/{staff_id}/gdrive-oauth/disconnect")
async def disconnect_gdrive_oauth(
    staff_id: UUID,
    service: StaffService = Depends(get_staff_service),
    cache: CacheService = Depends(get_cache)
):
    """Disconnect Google Drive OAuth"""
    from .google_oauth_service import GoogleOAuthService

    try:
        staff = service.get_by_id(staff_id)
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")

        # Try to revoke access if we have credentials
        if staff.get('gdrive_oauth_refresh_token'):
            try:
                oauth_service = GoogleOAuthService()
                credentials = oauth_service.get_credentials_from_staff(staff)
                if credentials:
                    oauth_service.revoke_access(credentials)
            except Exception as e:
                # Log but don't fail - still clear local tokens
                pass

        # Clear OAuth tokens
        update_data = {
            'gdrive_oauth_access_token': None,
            'gdrive_oauth_refresh_token': None,
            'gdrive_oauth_token_expiry': None,
            'gdrive_oauth_email': None,
            'gdrive_enabled': False,
            'gdrive_root_folder_id': None,
        }

        updated_staff = service.update(staff_id, update_data)
        if not updated_staff:
            raise HTTPException(status_code=500, detail="Failed to disconnect")

        # Invalidate cache
        invalidate_staff_cache(str(staff_id), cache)

        return {"message": "Successfully disconnected from Google Drive"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error disconnecting: {str(e)}")


@router.get("/{staff_id}/gdrive-oauth/folders", response_model=GoogleDriveFolderListResponse)
async def list_gdrive_folders(
    staff_id: UUID,
    parent_id: str = Query("root", description="Parent folder ID"),
    service: StaffService = Depends(get_staff_service)
):
    """List folders in Google Drive for folder selection"""
    from .google_oauth_service import GoogleOAuthService

    try:
        staff = service.get_by_id(staff_id)
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")

        oauth_service = GoogleOAuthService()
        credentials = oauth_service.get_credentials_from_staff(staff)

        if not credentials:
            raise HTTPException(status_code=400, detail="Google Drive not connected. Please connect first.")

        folders = oauth_service.list_folders(credentials, parent_id)

        return GoogleDriveFolderListResponse(
            folders=[GoogleDriveFolderResponse(**f) for f in folders],
            current_folder_id=parent_id
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing folders: {str(e)}")


@router.post("/{staff_id}/gdrive-oauth/folders", response_model=GoogleDriveFolderResponse)
async def create_gdrive_folder(
    staff_id: UUID,
    folder_data: GoogleDriveFolderCreateRequest,
    service: StaffService = Depends(get_staff_service)
):
    """Create a new folder in Google Drive"""
    from .google_oauth_service import GoogleOAuthService

    try:
        staff = service.get_by_id(staff_id)
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")

        oauth_service = GoogleOAuthService()
        credentials = oauth_service.get_credentials_from_staff(staff)

        if not credentials:
            raise HTTPException(status_code=400, detail="Google Drive not connected. Please connect first.")

        folder = oauth_service.create_folder(
            credentials,
            folder_data.name,
            folder_data.parent_id or "root"
        )

        if not folder:
            raise HTTPException(status_code=500, detail="Failed to create folder")

        return GoogleDriveFolderResponse(**folder)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating folder: {str(e)}")


@router.post("/{staff_id}/gdrive-oauth/select-folder")
async def select_gdrive_folder(
    staff_id: UUID,
    folder_data: GoogleDriveFolderSelectRequest,
    service: StaffService = Depends(get_staff_service),
    cache: CacheService = Depends(get_cache)
):
    """Select a folder as the root folder for exports"""
    from .google_oauth_service import GoogleOAuthService
    from googleapiclient.discovery import build

    try:
        staff = service.get_by_id(staff_id)
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")

        oauth_service = GoogleOAuthService()
        credentials = oauth_service.get_credentials_from_staff(staff)

        if not credentials:
            raise HTTPException(status_code=400, detail="Google Drive not connected. Please connect first.")

        drive_service = build('drive', 'v3', credentials=credentials)

        # Handle "root" specially - it's an alias for My Drive root
        if folder_data.folder_id == 'root':
            # Get the actual root folder info
            about = drive_service.about().get(fields='user').execute()
            folder = {
                'id': 'root',
                'name': 'My Drive',
                'webViewLink': 'https://drive.google.com/drive/my-drive'
            }
        else:
            # Verify the folder exists and get its info
            folder = drive_service.files().get(
                fileId=folder_data.folder_id,
                fields='id, name, webViewLink'
            ).execute()

        # Update staff record with selected folder
        update_data = {
            'gdrive_root_folder_id': folder_data.folder_id
        }

        updated_staff = service.update(staff_id, update_data)
        if not updated_staff:
            raise HTTPException(status_code=500, detail="Failed to save folder selection")

        # Invalidate cache
        invalidate_staff_cache(str(staff_id), cache)

        return {
            "message": f"Folder '{folder.get('name')}' selected as export destination",
            "folder_id": folder.get('id'),
            "folder_name": folder.get('name'),
            "folder_url": folder.get('webViewLink')
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error selecting folder: {str(e)}")