# MJ Estimate - Professional Insurance Estimate & Work Order Management System

> A comprehensive full-stack application for insurance restoration contractors to manage estimates, invoices, work orders, and water mitigation projects.

## 🎯 Overview

MJ Estimate is an enterprise-grade management system built specifically for insurance restoration contractors. It streamlines the entire workflow from initial estimate creation through water mitigation, reconstruction, and final invoicing.

### Key Capabilities

- **📋 Estimate & Invoice Management** - Create professional estimates and invoices with customizable templates
- **🏗️ Work Order System** - Complete work order lifecycle management with staff assignment and tracking
- **💧 Water Mitigation** - Specialized water damage assessment and mitigation workflow with photo management
- **🔨 Reconstruction Estimates** - Material detection, pack-out calculations, and debris estimation
- **📐 Interior Sketching** - Interactive canvas-based floor plan and interior sketching tool
- **📸 AI Photo Analysis** - Intelligent room analysis and item detection from photos
- **🔗 External Integrations** - CompanyCam, Google Sheets, and Slack integrations
- **📊 Analytics & Reporting** - Comprehensive dashboard with business insights
- **👥 Multi-user Support** - Role-based access control (Admin, Manager, Staff)

## 🏗️ Architecture

### Technology Stack

#### Backend
- **Framework**: FastAPI 0.104+ (Python 3.9+)
- **Database**: PostgreSQL with SQLAlchemy ORM
- **Architecture**: Domain-Driven Design (DDD)
- **Authentication**: JWT with bcrypt password hashing
- **File Storage**: Google Drive / Google Cloud Storage / Local
- **API Documentation**: Auto-generated OpenAPI (Swagger)

#### Frontend
- **Framework**: React 18.3+ with TypeScript 4.9+
- **UI Library**: Ant Design 5.27+
- **State Management**: Zustand + TanStack React Query
- **Routing**: React Router v7
- **Canvas Drawing**: Konva.js & React-Konva
- **Charts**: Recharts & Ant Design Charts
- **Build Tool**: Create React App with CRACO
- **Performance**: React Lazy Loading + Code Splitting

#### External Integrations
- **Photo Management**: CompanyCam API (webhook-based photo sync)
- **Spreadsheets**: Google Sheets API (bidirectional sync)
- **Notifications**: Slack Webhooks
- **AI Analysis**: Google Vision AI / Custom ML Models

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │Dashboard │  │Estimates │  │Work      │  │Water     │   │
│  │          │  │& Invoices│  │Orders    │  │Mitigation│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│       ↓              ↓              ↓              ↓        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │        React Query (API State Management)           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↕ HTTP/REST API
┌─────────────────────────────────────────────────────────────┐
│                    Backend (FastAPI)                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │               Domain Layer (Business Logic)          │  │
│  ├──────────┬──────────┬──────────┬──────────┬─────────┤  │
│  │  Auth    │ Company  │ Estimate │  Work    │  Water  │  │
│  │          │          │ Invoice  │  Order   │  Mitig. │  │
│  ├──────────┼──────────┼──────────┼──────────┼─────────┤  │
│  │  Pack    │  Photo   │ Material │ Interior │ Integra-│  │
│  │  Calc    │ Analysis │Detection │ Sketch   │ tions   │  │
│  └──────────┴──────────┴──────────┴──────────┴─────────┘  │
│                              ↕                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          Repository Layer (Data Access)              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                PostgreSQL Database                          │
│  ┌──────────┬──────────┬──────────┬──────────┬─────────┐  │
│  │  Users   │Companies │Estimates │  Work    │  Photos │  │
│  │  Roles   │Licenses  │Invoices  │  Orders  │  Files  │  │
│  └──────────┴──────────┴──────────┴──────────┴─────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 📂 Project Structure

```
mj-react-app/
├── backend/                    # FastAPI Backend
│   ├── app/
│   │   ├── core/              # Core configuration & database
│   │   │   ├── config.py      # Environment settings
│   │   │   ├── database_factory.py  # Database abstraction
│   │   │   └── logging_config.py    # Logging setup
│   │   ├── common/            # Shared components
│   │   │   ├── base_repository.py   # Repository pattern base
│   │   │   └── services/      # Common services (PDF, etc.)
│   │   ├── domains/           # Business domains (DDD)
│   │   │   ├── auth/          # Authentication & authorization
│   │   │   ├── company/       # Company & client management
│   │   │   ├── invoice/       # Invoice creation & management
│   │   │   ├── estimate/      # Estimate workflows
│   │   │   ├── work_order/    # Work order lifecycle
│   │   │   ├── water_mitigation/  # Water damage projects
│   │   │   ├── reconstruction_estimate/  # Reconstruction
│   │   │   ├── pack_calculation/  # Pack-out calculations
│   │   │   ├── photo_analysis/    # AI photo analysis
│   │   │   ├── material_detection/  # AI material detection
│   │   │   ├── sketch/        # Interior sketching
│   │   │   ├── integrations/  # External service integrations
│   │   │   │   ├── companycam/    # CompanyCam API
│   │   │   │   ├── google_sheets/ # Google Sheets sync
│   │   │   │   └── slack/         # Slack notifications
│   │   │   ├── line_items/    # Line item catalog
│   │   │   ├── receipt/       # Receipt management
│   │   │   ├── staff/         # Staff & permissions
│   │   │   ├── payment/       # Payment tracking
│   │   │   ├── document/      # Document management
│   │   │   ├── file/          # File storage management
│   │   │   ├── storage/       # Multi-provider storage
│   │   │   └── dashboard/     # Analytics & dashboard
│   │   ├── templates/         # Jinja2 PDF templates
│   │   └── main.py           # FastAPI application entry
│   ├── alembic/              # Database migrations
│   ├── tests/                # Backend tests
│   ├── scripts/              # Utility scripts
│   ├── docs/                 # Backend documentation
│   ├── requirements.txt      # Python dependencies
│   ├── .env.development      # Development environment vars
│   └── .env.production       # Production environment vars
│
├── frontend/                  # React Frontend
│   ├── src/
│   │   ├── components/       # Reusable React components
│   │   │   ├── auth/         # Authentication components
│   │   │   ├── common/       # Shared UI components
│   │   │   ├── estimate/     # Estimate-specific components
│   │   │   ├── invoice/      # Invoice-specific components
│   │   │   ├── work-order/   # Work order components
│   │   │   ├── water-mitigation/  # Water mitigation UI
│   │   │   ├── pack-calculation/  # Pack calculation UI
│   │   │   └── sketch/       # Canvas drawing components
│   │   ├── pages/            # Main application pages
│   │   ├── services/         # API integration layer
│   │   ├── contexts/         # React Context providers
│   │   ├── hooks/            # Custom React hooks
│   │   ├── types/            # TypeScript type definitions
│   │   ├── utils/            # Utility functions
│   │   └── App.tsx           # Main app with routing
│   ├── public/               # Static assets
│   ├── package.json          # Node dependencies
│   └── tsconfig.json         # TypeScript configuration
│
├── docs/                     # Project documentation
├── docker-compose.yml        # Production Docker setup
├── docker-compose.dev.yml    # Development Docker setup
└── README.md                 # This file
```

## 📚 Complete Feature List

### Backend API Features

#### 1. Authentication & Authorization (`/api/auth`)
- JWT-based authentication with refresh tokens
- User registration and login
- Password reset functionality
- Role-based access control (Admin, Manager, Staff)
- Staff management with hierarchical permissions

#### 2. Company Management (`/api/companies`)
- Company profile creation and management
- Company-specific numbering sequences
- Logo upload and management
- Contact information and address tracking
- Multi-tenant support

#### 3. Estimate Management (`/api/estimates`)
- Full CRUD operations for estimates
- Multiple estimate types (Standard, Insurance)
- Auto-generate estimate numbers per company
- Line items with taxes and discounts
- Room-based organization
- PDF generation with custom templates
- Estimate to invoice conversion
- Duplicate/clone functionality
- Acceptance/rejection workflows
- Insurance estimate support:
  - Claim numbers and policy details
  - Deductible tracking
  - Depreciation calculations
  - ACV/RCV calculations

#### 4. Invoice Management (`/api/invoices`)
- Full invoice lifecycle management
- Auto-generated invoice numbers
- Flexible line items with tax calculations
- Client-specific and company-specific invoices
- Payment tracking with multiple payment records
- Adjustments and line-item grouping
- HTML and PDF generation
- Invoice duplication
- Receipt generation (HTML/PDF)
- Tax methods (percentage/specific amount)
- Operational percent (OP) handling
- Discount management
- Payment history tracking

#### 5. Work Order System (`/api/work-orders`)
- Complete work order lifecycle
- Status tracking with multiple states
- Staff assignment and creation tracking
- Trade-based cost calculation
- Priority levels (Low, Medium, High, Urgent)
- Additional costs management
- Batch operations
- Company filtering
- Staff-specific work order retrieval
- Dashboard statistics
- File attachment with counting
- Cost breakdown calculations

#### 6. Water Mitigation (`/api/water-mitigation`)
- Job creation and management
- Photo attachment and organization by date
- Job status tracking with history
- Photo categorization
- Bulk date operations
- Report generation (multiple formats)
- Report templates and configuration
- CompanyCam webhook integration for photo sync
- Cloud storage support
- Photo soft delete (trash/restore)
- Optimized batch photo loading

#### 7. Pack Calculation (`/api/pack-calculation`)
- AI-powered room analysis via photo
- Template-based room inventory calculation
- Storage multiplier calculations
- Density modifiers for items
- Bulk text parsing for item entry
- Item material mapping
- ML training data management
- Analysis caching for performance
- Multiple input methods (structured, text, image)

#### 8. Photo Analysis (`/api/photo-analysis`)
- AI vision-powered room photo analysis
- Item detection and categorization
- Room type classification
- Multi-photo support (1-10 photos)
- Analysis caching
- Confidence scoring

#### 9. Reconstruction Estimate (`/api/reconstruction-estimate`)
- Debris calculation
- Material estimation
- Content packout analysis
- Multi-room support
- Cost aggregation

#### 10. Material Detection (`/api/material-detection`)
- Background job processing
- Multiple provider support (Roboflow, Google Vision)
- Confidence threshold configuration
- Image analysis pipeline
- Job status tracking
- Health monitoring

#### 11. Line Items (`/api/line-items`)
- Predefined line item library
- Category and subcategory organization
- Xactimate integration
- Pricing templates
- Usage tracking

#### 12. Payment System (`/api/payments`, `/api/payment-config`)
- Payment method configuration
- Payment tracking and recording
- Tax configuration
- Discount management
- Payment terms setup

#### 13. PDF Editor (`/api/pdf-editor`)
- Template-based PDF generation
- Custom field mapping
- Form generation
- Document preview
- Export functionality

#### 14. File & Document Management (`/api/files`, `/api/documents`)
- Multi-storage provider support:
  - Local filesystem
  - Google Drive (30GB free)
  - Google Cloud Storage
  - AWS S3 (extensible)
  - Azure Blob (extensible)
- File upload/download
- File organization by context
- Document type classification
- Document search

#### 15. Dashboard & Analytics (`/api/dashboard`, `/api/analytics`)
- Real-time dashboard statistics
- Company metrics
- Work order analytics
- Financial reporting
- API usage metrics

#### 16. External Integrations (`/api/integrations`)

**CompanyCam Integration:**
- Webhook-based photo sync (photo.created, photo.deleted)
- Project search and auto-match by address
- Batch photo loading optimization
- Real-time photo updates

**Google Sheets Integration:**
- Bidirectional sync (read/write)
- Auto-scheduled sync (every 5 minutes during business hours)
- Duplicate lead prevention via street address matching
- Lead import automation

**Slack Integration:**
- Notification templates
- Real-time alerts for work order updates
- Batch notification grouping

### Frontend Features

#### Authentication & Security
- Login page with email/password
- Forgot password flow
- Password reset functionality
- Protected route system with role-based access

#### Dashboard
- Role-based dashboards (Admin/Manager/Staff)
- Company overview
- Quick statistics
- Recent activity feed
- Work order summary

#### Estimate Management
- Estimate creation form with line item builder
- Room-based grouping
- Real-time tax calculation
- Insurance estimate support with ACV/RCV
- PDF preview and generation
- Save and continue functionality
- Estimate editing

#### Invoice Management
- Full invoice creation workflow
- Real-time line item calculation
- Tax configuration
- Payment tracking
- Adjustments support
- Section grouping
- PDF/HTML preview
- Invoice duplication
- Edit existing invoices

#### Work Orders
- Work order creation with staff assignment
- Status tracking and updates
- Cost calculation by trade
- Priority assignment
- File attachment with gallery view
- List view with filtering and search
- Detail view with full information

#### Water Mitigation
- Job creation and management
- Photo gallery with date-based categorization
- Multi-select and bulk operations
- Status tracking with history
- Report generation with templates
- Photo organization tools
- Search and filter capabilities

#### Pack Calculator
- Room photo upload
- AI-powered room analysis
- Item list generation with quantities
- Material mapping
- Template-based calculation
- Bulk text parsing for fast entry
- History and list view

#### Admin Features
- Admin dashboard with system metrics
- API usage monitoring
- System configuration
- User management
- Material management
- Document types management
- Cache monitoring

## 🚀 Quick Start

### Prerequisites

- **Node.js** 16+ and npm
- **Python** 3.9+ (3.12 recommended)
- **PostgreSQL** 13+ (or use Docker)
- **Git**

### Installation

#### 1. Clone the Repository
```bash
git clone <repository-url>
cd mj-react-app
```

#### 2. Backend Setup
```bash
cd backend

# Create virtual environment
python -m venv .venv

# Activate virtual environment
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Setup environment variables
copy .env.example .env.development
# Edit .env.development with your configuration

# Run database migrations
alembic upgrade head

# Start backend server
uvicorn app.main:app --reload --port 8000
```

#### 3. Frontend Setup
```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm start
```

### Quick Start (Automated)

**Windows:**
```bash
start_servers.bat
```

This will start both backend and frontend servers automatically.

### Docker Setup

```bash
# Development
docker-compose -f docker-compose.dev.yml up

# Production
docker-compose up
```

## 🌐 Application URLs

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:3000 | React application |
| Backend API | http://localhost:8000 | FastAPI REST API |
| API Docs (Swagger) | http://localhost:8000/docs | Interactive API documentation |
| API Docs (ReDoc) | http://localhost:8000/redoc | Alternative API documentation |
| PgAdmin (Docker) | http://localhost:8080 | Database management UI |

## 🔐 Environment Configuration

### Backend (.env.development)

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/mjestimate_dev
DATABASE_TYPE=postgresql

# Security
SECRET_KEY=your-secret-key-here
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# Storage (choose one provider)
STORAGE_PROVIDER=local  # Options: local, gdrive, gcs, s3
STORAGE_BASE_DIR=uploads

# Google Drive (if using gdrive)
GDRIVE_SERVICE_ACCOUNT_FILE=./secrets/service-account-key.json
GDRIVE_ROOT_FOLDER_ID=your_folder_id

# External Integrations (optional)
ENABLE_INTEGRATIONS=true
COMPANYCAM_API_KEY=your-companycam-key
COMPANYCAM_WEBHOOK_TOKEN=your-webhook-token
SLACK_WEBHOOK_URL=your-slack-webhook-url
GOOGLE_SHEETS_ENABLED=true

# AI Features (optional)
OPENAI_API_KEY=your-openai-key
```

### Frontend (.env)

```bash
REACT_APP_API_URL=http://localhost:8000
REACT_APP_ENV=development
```

## 📦 Production Deployment

### Recommended Stack
```
Frontend: Vercel (Free)
Backend:  Render ($7/month for always-on)
Database: NeonDB (Free tier - 0.5GB)
Storage:  Google Drive (30GB free)
```

**Total Cost**: ~$7/month for stable production

### Deployment Architecture
```
┌─────────────┐      ┌──────────────┐      ┌──────────────┐
│   Vercel    │ ───> │    Render    │ ───> │   NeonDB     │
│  (Frontend) │      │  (Backend)   │      │ (PostgreSQL) │
│    Free     │      │    $7/mo     │      │     Free     │
└─────────────┘      └──────────────┘      └──────────────┘
        │                    │
        │                    ├──> Google Drive (File Storage)
        │                    ├──> Google Sheets (Scheduled Sync)
        │                    ├──> CompanyCam (Webhooks)
        │                    └──> Slack (Notifications)
```

📖 **Full deployment guide**: See [DEPLOYMENT.md](./DEPLOYMENT.md)

## 🛠️ Development Guide

### Adding a New Domain (Backend)

1. Create domain directory:
```bash
mkdir -p backend/app/domains/new_domain
```

2. Create domain files following the DDD pattern:
- `models.py` - Database models
- `schemas.py` - Pydantic schemas
- `repository.py` - Data access layer
- `service.py` - Business logic
- `api.py` - REST endpoints

3. Register router in `main.py`:
```python
from app.domains.new_domain.api import router as new_domain_router
app.include_router(new_domain_router, prefix="/api/new-domain", tags=["New Domain"])
```

### Adding a New Page (Frontend)

1. Create page component:
```typescript
// src/pages/NewPage.tsx
import React from 'react';

const NewPage: React.FC = () => {
  return <div>New Page Content</div>;
};

export default NewPage;
```

2. Add lazy import and route in `App.tsx`:
```typescript
// Add lazy import at top
const NewPage = lazy(() => import('./pages/NewPage'));

// Add route (MUST wrap in Suspense)
{
  path: "/new-page",
  element: (
    <ProtectedRoute>
      <Layout>
        <Suspense fallback={<PageLoader />}>
          <NewPage />
        </Suspense>
      </Layout>
    </ProtectedRoute>
  )
}
```

### Database Migrations

```bash
# Create a new migration
alembic revision --autogenerate -m "Add new table"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

## 🧪 Testing

### Backend Tests
```bash
cd backend
pytest                           # Run all tests
pytest tests/test_estimates.py   # Run specific test file
pytest --cov=app tests/          # Run with coverage
```

### Frontend Tests
```bash
cd frontend
npm test                         # Run tests
npm test -- --coverage           # Run with coverage
```

## 🔧 Troubleshooting

### Common Issues

#### Backend won't start
```bash
# Check Python version
python --version  # Should be 3.9+

# Check if port 8000 is in use
netstat -ano | findstr :8000

# Verify database connection
psql -h localhost -U postgres -d mjestimate_dev
```

#### Frontend won't start
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Check if port 3000 is in use
netstat -ano | findstr :3000
```

#### CompanyCam webhook not working
```bash
# Check webhook configuration
curl http://localhost:8000/api/integrations/health

# View recent webhooks
curl http://localhost:8000/api/integrations/webhook-events?service_name=companycam
```

## 📖 API Documentation

Once the backend is running, comprehensive API documentation is available at:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## 📝 Contributing

### Branch Strategy
- `main` - Production-ready code
- `develop` - Development branch
- `feature/*` - Feature branches
- `hotfix/*` - Emergency fixes

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## 📄 License

Copyright © 2024 MJ Estimate. All rights reserved.

## 🤝 Support

For support, please contact the development team or create an issue in the repository.

---

**Built with ❤️ for insurance restoration contractors**
