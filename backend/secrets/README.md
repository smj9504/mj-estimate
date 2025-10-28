# Secrets Directory

This directory stores sensitive credential files that should **NEVER** be committed to Git.

## 📁 Directory Structure

```
backend/secrets/
├── README.md                           # This file
├── .gitkeep                           # Keep directory in Git
├── service-account-key.json           # Google Drive Service Account (DO NOT COMMIT)
└── .env.local                         # Local overrides (DO NOT COMMIT)
```

## 🔐 Stored Files

### 1. service-account-key.json
- **Purpose**: Google Drive API authentication
- **Generated**: Google Cloud Console → Service Accounts → Keys
- **Used by**: Storage Provider (Google Drive)
- **Environment Variable**: `GDRIVE_SERVICE_ACCOUNT_FILE=./secrets/service-account-key.json`

### 2. .env.local (Optional)
- **Purpose**: Local environment variable overrides
- **Priority**: Overrides `.env.development`
- **Use Case**: Developer-specific settings

## ⚠️ Security Guidelines

### DO NOT
- ❌ Commit any files in this directory (except README.md)
- ❌ Share these files via email or chat
- ❌ Upload to public repositories
- ❌ Store in unencrypted cloud storage

### DO
- ✅ Keep files in this directory only
- ✅ Use `.gitignore` to exclude sensitive files
- ✅ Use Secret Manager in production (Render, AWS, etc.)
- ✅ Rotate keys regularly (every 3 months)
- ✅ Restrict file permissions: `chmod 600 secrets/*.json`

## 🚀 Setup Instructions

### Development

1. **Download Service Account Key**
   ```bash
   # From Google Cloud Console
   # Save to: backend/secrets/service-account-key.json
   ```

2. **Set File Permissions** (Linux/Mac)
   ```bash
   chmod 600 secrets/service-account-key.json
   ```

3. **Update Environment Variable**
   ```bash
   # .env.development
   GDRIVE_SERVICE_ACCOUNT_FILE=./secrets/service-account-key.json
   ```

### Production (Render)

**Option 1: Environment File** (Recommended)
```
Render Dashboard → Service → Environment → Add File
- Key: GDRIVE_SERVICE_ACCOUNT_FILE
- Upload: service-account-key.json
```

**Option 2: Secret Manager**
```bash
# Store in Render Secret Files
# Reference in environment: /etc/secrets/service-account-key.json
```

## 📝 File Templates

### .gitignore (Already configured)
```gitignore
# Secrets directory - only allow README.md
secrets/*
!secrets/README.md
!secrets/.gitkeep
```

### .env.local Template
```bash
# Local developer overrides
# Copy from .env.development and customize

# Google Drive (if testing)
STORAGE_PROVIDER=gdrive
GDRIVE_SERVICE_ACCOUNT_FILE=./secrets/service-account-key.json
GDRIVE_ROOT_FOLDER_ID=your_test_folder_id

# Database (if using local postgres)
DATABASE_URL=postgresql://user:pass@localhost:5432/testdb
```

## 🔄 Key Rotation

### When to Rotate
- Every 3 months (recommended)
- When team member leaves
- After security incident
- Before public release

### How to Rotate

1. **Generate New Key**
   ```
   Google Cloud Console → Service Account → Keys → ADD KEY
   ```

2. **Download and Replace**
   ```bash
   mv ~/Downloads/new-key.json secrets/service-account-key.json
   ```

3. **Test**
   ```bash
   uvicorn app.main:app --reload
   # Check: "Google Drive provider initialized"
   ```

4. **Delete Old Key**
   ```
   Google Cloud Console → Service Account → Keys → Delete old key
   ```

## 📊 Environment Priority

Files are loaded in this order (last wins):
```
1. .env                    # Base configuration
2. .env.development        # Environment-specific
3. secrets/.env.local      # Local overrides (highest priority)
4. System environment      # OS environment variables
```

## 🆘 Recovery

### Lost Service Account Key

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. IAM & Admin → Service Accounts
3. Select service account
4. Keys → ADD KEY → Create new key → JSON
5. Download and save to `secrets/service-account-key.json`

### Accidentally Committed to Git

1. **Immediately** revoke the key:
   ```
   Google Cloud Console → Service Account → Keys → DELETE
   ```

2. Generate new key (see Recovery section)

3. Remove from Git history:
   ```bash
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch secrets/service-account-key.json" \
     --prune-empty --tag-name-filter cat -- --all
   ```

4. Force push (be careful):
   ```bash
   git push origin --force --all
   ```

## 📚 Related Documentation

- [Google Cloud Setup Guide](../docs/GOOGLE_CLOUD_SETUP.md)
- [Storage Quick Start](../docs/STORAGE_QUICK_START.md)
- [Security Best Practices](../docs/SECURITY.md)

## ✅ Checklist

### Initial Setup
- [ ] Create `secrets/` directory
- [ ] Download service account key
- [ ] Save as `secrets/service-account-key.json`
- [ ] Set file permissions: `chmod 600`
- [ ] Update `.env.development`
- [ ] Test: `uvicorn app.main:app --reload`
- [ ] Verify `.gitignore` excludes secrets

### Regular Maintenance
- [ ] Review access quarterly
- [ ] Rotate keys every 3 months
- [ ] Audit usage logs
- [ ] Update documentation

---

**Last Updated**: 2025-01-28
**Security Level**: HIGH - Handle with care!
