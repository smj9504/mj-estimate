# Storage Module

Flexible storage abstraction layer supporting multiple storage providers.

## Supported Providers

### 1. Local Storage (Development)
- **Provider**: `local`
- **Use Case**: Development, small deployments
- **Storage**: Local filesystem
- **Cost**: Free (limited by server disk)

### 2. Google Drive (Production - Recommended)
- **Provider**: `gdrive`
- **Use Case**: Production deployments
- **Storage**: Google Drive (30GB free)
- **Cost**: Free (30GB) / $1.99/month (100GB)

### 3. AWS S3 (Future)
- **Provider**: `s3`
- **Status**: Not yet implemented
- **Use Case**: Large-scale production
- **Cost**: Pay per use

### 4. Azure Blob (Future)
- **Provider**: `azure`
- **Status**: Not yet implemented
- **Use Case**: Azure-based deployments
- **Cost**: Pay per use

---

## Configuration

### Local Storage

```.env
# Storage provider
STORAGE_PROVIDER=local

# Base directory for uploads (relative to backend root)
STORAGE_BASE_DIR=uploads
```

### Google Drive

1. **Create Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create new project: "MJ Estimate Storage"

2. **Enable Google Drive API**
   - APIs & Services → Library
   - Search "Google Drive API" → Enable

3. **Create Service Account**
   - IAM & Admin → Service Accounts
   - Create Service Account: "mj-storage"
   - Role: Editor
   - Create JSON key → Download

4. **Create Root Folder in Google Drive**
   - Create folder: "MJ Estimate"
   - Share with service account email (xxx@project.iam.gserviceaccount.com)
   - Permission: Editor
   - Copy Folder ID from URL

5. **Configure Environment**

```.env
# Storage provider
STORAGE_PROVIDER=gdrive

# Service account key file path
GDRIVE_SERVICE_ACCOUNT_FILE=./secrets/service-account-key.json

# Root folder ID (from Google Drive URL)
GDRIVE_ROOT_FOLDER_ID=1abc...xyz
```

---

## Usage

### Basic Usage

```python
from app.domains.storage import StorageFactory

# Get storage provider (automatically uses configured provider)
storage = StorageFactory.get_instance()

# Upload file
with open('photo.jpg', 'rb') as f:
    result = storage.upload(
        file_data=f,
        filename='bathroom_before.jpg',
        context='water-mitigation',
        context_id='job-123',
        category='before',
        content_type='image/jpeg',
        metadata={'property_address': '123 Main St'}
    )

print(f"File ID: {result.file_id}")
print(f"File URL: {result.file_url}")
print(f"Thumbnail: {result.thumbnail_url}")
print(f"Folder Path: {result.folder_path}")
```

### File Operations

```python
# Download file
file_content = storage.download(file_id)

# Get file URL
url = storage.get_url(file_id)

# Get file metadata
metadata = storage.get_metadata(file_id)
print(f"Size: {metadata.size} bytes")
print(f"MIME Type: {metadata.mime_type}")

# Update metadata
storage.update_metadata(
    file_id=file_id,
    filename='new_name.jpg',
    metadata={'category': 'after', 'notes': 'Updated photo'}
)

# List files
files = storage.list_files(
    context='water-mitigation',
    context_id='job-123',
    category='before'
)

# Move file to different category
storage.move(
    file_id=file_id,
    new_category='after',
    context='water-mitigation',
    context_id='job-123'
)

# Delete file
storage.delete(file_id)

# Check if file exists
if storage.exists(file_id):
    print("File exists")
```

### Advanced Usage

```python
# Create specific provider (override environment)
from app.domains.storage import StorageFactory

local_storage = StorageFactory.create('local')
gdrive_storage = StorageFactory.create('gdrive')

# Use specific provider
result = gdrive_storage.upload(...)
```

---

## Folder Structure

### Local Storage
```
uploads/
  └─ water-mitigation/
      └─ job-123/
          ├─ before/
          │   ├─ photo1.jpg
          │   └─ thumb_photo1.jpg
          ├─ after/
          │   └─ photo2.jpg
          └─ documents/
              └─ invoice.pdf
```

### Google Drive
```
MJ Estimate/
  └─ water-mitigation/
      └─ 12ab34cd_123-Main-Street/
          ├─ before/
          │   └─ photo1.jpg
          ├─ after/
          │   └─ photo2.jpg
          └─ documents/
              └─ invoice.pdf
```

---

## Migration Between Providers

### Migrate from Local to Google Drive

```python
from app.domains.storage import StorageFactory, LocalStorageProvider
from pathlib import Path

# Initialize both providers
local = LocalStorageProvider()
gdrive = StorageFactory.create('gdrive')

# Get all local files
context = 'water-mitigation'
context_id = 'job-123'

local_files = local.list_files(context, context_id)

# Migrate each file
for file_meta in local_files:
    # Download from local
    file_content = local.download(file_meta.file_id)

    # Upload to Google Drive
    with io.BytesIO(file_content) as f:
        result = gdrive.upload(
            file_data=f,
            filename=file_meta.filename,
            context=context,
            context_id=context_id,
            content_type=file_meta.mime_type
        )

    print(f"Migrated: {file_meta.filename} -> {result.file_id}")

    # Optional: Delete from local after successful upload
    # local.delete(file_meta.file_id)
```

---

## Testing

### Test Local Storage

```bash
# Set environment
export STORAGE_PROVIDER=local
export STORAGE_BASE_DIR=test_uploads

# Run tests
pytest app/domains/storage/tests/test_local_provider.py
```

### Test Google Drive

```bash
# Set environment
export STORAGE_PROVIDER=gdrive
export GDRIVE_SERVICE_ACCOUNT_FILE=./secrets/service-account-key.json
export GDRIVE_ROOT_FOLDER_ID=your_folder_id

# Run tests
pytest app/domains/storage/tests/test_google_drive_provider.py
```

---

## Troubleshooting

### Google Drive Issues

**Problem**: "Failed to initialize Google Drive"
- **Solution**: Check service account JSON file path and permissions

**Problem**: "Failed to create folder"
- **Solution**: Verify service account has Editor permission on root folder

**Problem**: "Quota exceeded"
- **Solution**: Check Google Drive API quota limits (20,000 requests/100 seconds)

### Local Storage Issues

**Problem**: "Permission denied"
- **Solution**: Check directory permissions: `chmod 755 uploads/`

**Problem**: "Disk full"
- **Solution**: Check available disk space: `df -h`

---

## Performance Considerations

### Local Storage
- **Pros**: Fast, no network latency
- **Cons**: Limited by disk space, not scalable

### Google Drive
- **Pros**: 30GB free, automatic backup, scalable
- **Cons**: Network latency, API rate limits

### Optimization Tips
1. **Caching**: Cache folder IDs to reduce API calls
2. **Batch Operations**: Upload multiple files in parallel
3. **Thumbnail Generation**: Let Google Drive generate thumbnails
4. **Connection Pooling**: Reuse HTTP connections

---

## Security Best Practices

1. **Never commit credentials**
   ```gitignore
   secrets/service-account-key.json
   .env
   ```

2. **Use environment variables**
   - Store secrets in environment variables
   - Use different keys for dev/staging/production

3. **Limit service account permissions**
   - Only grant necessary permissions
   - Use separate service accounts per environment

4. **Rotate credentials regularly**
   - Generate new service account keys quarterly
   - Revoke old keys after rotation

---

## Future Providers

### AWS S3 (Planned)

```.env
STORAGE_PROVIDER=s3
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_S3_BUCKET=mj-estimate
AWS_REGION=us-west-2
```

### Azure Blob (Planned)

```.env
STORAGE_PROVIDER=azure
AZURE_STORAGE_CONNECTION_STRING=your_connection_string
AZURE_CONTAINER_NAME=mj-estimate
```

---

## Support

For issues or questions:
- GitHub Issues: [Project Issues]
- Email: [Support Email]
- Docs: [Documentation URL]
