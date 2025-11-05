# MJ Estimate - Professional Insurance Estimate & Work Order Management System

> A comprehensive full-stack application for insurance restoration contractors to manage estimates, invoices, work orders, and water mitigation projects.

## 🎯 Overview

MJ Estimate is an enterprise-grade management system built specifically for insurance restoration contractors. It streamlines the entire workflow from initial estimate creation through water mitigation, reconstruction, and final invoicing.

### Key Capabilities

- **📋 Estimate & Invoice Management** - Create professional estimates and invoices with customizable templates
- **🏗️ Work Order System** - Complete work order lifecycle management with staff assignment and tracking
- **💧 Water Mitigation** - Specialized water damage assessment and mitigation workflow
- **🔨 Reconstruction Estimates** - Material detection, pack-out calculations, and debris estimation
- **📐 Interior Sketching** - Interactive canvas-based floor plan and interior sketching tool
- **🔗 External Integrations** - CompanyCam, Google Sheets, and Slack integrations
- **📊 Analytics & Reporting** - Comprehensive dashboard with business insights
- **👥 Multi-user Support** - Role-based access control (Admin, Manager, User)

## 🏗️ Architecture

### Technology Stack

#### Backend
- **Framework**: FastAPI 0.104+ (Python 3.9+)
- **Database**: PostgreSQL with SQLAlchemy ORM
- **Architecture**: Domain-Driven Design (DDD)
- **Authentication**: JWT with bcrypt password hashing
- **File Storage**: Google Cloud Storage / Google Drive / Local
- **API Documentation**: Auto-generated OpenAPI (Swagger)

#### Frontend
- **Framework**: React 18.3+ with TypeScript 4.9+
- **UI Library**: Ant Design 5.27+
- **State Management**: Zustand + TanStack React Query
- **Routing**: React Router v6
- **Canvas Drawing**: Konva.js & React-Konva
- **Charts**: Recharts & Ant Design Charts
- **Build Tool**: Create React App with CRACO

#### External Integrations
- **Photo Management**: CompanyCam API
- **Spreadsheets**: Google Sheets API
- **Notifications**: Slack Webhooks
- **Material Detection**: Google Vision AI (Optional)

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
│  │          │          │ Invoice  │  Order   │  Mitigation│
│  ├──────────┼──────────┼──────────┼──────────┼─────────┤  │
│  │ Material │   Pack   │ Interior │ Document │ Integra-│  │
│  │Detection │  Calc    │ Sketch   │ Types    │ tions   │  │
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
│   │   │   └── base_repository.py   # Repository pattern base
│   │   ├── domains/           # Business domains (DDD)
│   │   │   ├── auth/          # Authentication & authorization
│   │   │   ├── company/       # Company & client management
│   │   │   ├── invoice/       # Invoice creation & management
│   │   │   ├── estimate/      # Estimate workflows
│   │   │   ├── work_order/    # Work order lifecycle
│   │   │   ├── water_mitigation/  # Water damage projects
│   │   │   ├── reconstruction_estimate/  # Reconstruction estimates
│   │   │   ├── pack_calculation/  # Pack-out calculations
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
│   │   │   └── dashboard/     # Analytics & dashboard
│   │   ├── templates/         # Jinja2 PDF templates
│   │   └── main.py           # FastAPI application entry
│   ├── alembic/              # Database migrations
│   ├── tests/                # Backend tests
│   ├── scripts/              # Utility scripts
│   ├── requirements.txt      # Python dependencies
│   └── .env.development      # Development environment vars
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
│   │   │   └── sketch/       # Canvas drawing components
│   │   ├── pages/            # Main application pages
│   │   │   ├── Login.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── EstimateCreation.tsx
│   │   │   ├── WorkOrderList.tsx
│   │   │   └── ...
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
├── docs/                     # Documentation (gitignored)
├── docker-compose.yml        # Production Docker setup
├── docker-compose.dev.yml    # Development Docker setup
└── README.md                 # This file
```

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

## 🔐 Environment Configuration

### Backend (.env.development)

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/mjestimate_dev
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-key

# Security
SECRET_KEY=your-secret-key-here
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# Storage (choose one)
STORAGE_BACKEND=gcs  # Options: local, google_drive, gcs
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=secrets/service-account-key.json

# External Integrations (optional)
ENABLE_INTEGRATIONS=true
COMPANYCAM_API_KEY=your-companycam-key
COMPANYCAM_WEBHOOK_TOKEN=your-webhook-token
SLACK_WEBHOOK_URL=your-slack-webhook-url
GOOGLE_SHEETS_ENABLED=true

# Email (optional)
EMAIL_ENABLED=true
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@example.com
SMTP_PASSWORD=your-app-password

# Material Detection (optional)
ENABLE_MATERIAL_DETECTION=false
GOOGLE_VISION_API_KEY=your-vision-api-key
```

### Frontend (.env)

```bash
REACT_APP_API_URL=http://localhost:8000
REACT_APP_ENV=development
```

## 📚 Key Features Deep Dive

### 1. Estimate & Invoice Management

- **Rich Text Editor** for detailed descriptions
- **Line Item System** with drag-and-drop ordering
- **Template System** for customizable layouts
- **PDF Generation** with company branding
- **Email Integration** for direct sending
- **Duplicate & Clone** functionality

### 2. Work Order System

- **Complete Lifecycle** management (Draft → In Progress → Completed)
- **Staff Assignment** with role-based permissions
- **Photo Gallery** with drag-and-drop upload
- **Payment Tracking** with multiple payment methods
- **Credit/Discount** management
- **Status Timeline** with activity history

### 3. Water Mitigation

- **CompanyCam Integration** - Auto-sync photos from projects
- **Date-based Grouping** - Photos organized by date
- **Equipment Tracking** - Monitor dehumidifiers, fans, etc.
- **Moisture Readings** - Track daily measurements
- **Report Generation** - Professional PDF reports
- **Real-time Updates** via webhooks

### 4. Reconstruction Estimates

- **Material Detection** - AI-powered material identification from photos
- **Debris Calculator** - Calculate debris volume and disposal costs
- **Pack-Out Calculator** - Intelligent furniture content estimation
  - Fuzzy input processing ("medium bookshelf + contents")
  - Automatic box type selection based on furniture
  - Labor hours calculation
- **Interior Sketching** - Canvas-based floor plan drawing
  - Wall, door, window tools
  - Fixture placement (toilets, sinks, tubs)
  - Area measurement
  - Export to image

### 5. External Integrations

#### CompanyCam
- **Webhook Events** - photo.created, project.created
- **Auto Photo Sync** - Automatically download photos to water mitigation jobs
- **Address Matching** - Smart address matching with existing projects
- **Batch Notifications** - Grouped Slack alerts

#### Google Sheets
- **Scheduled Sync** - Business hours only (9 AM - 5 PM, Mon-Fri)
- **Invoice Export** - Auto-export invoice data
- **Conflict Detection** - Prevent duplicate entries
- **Rate Limiting** - Respect API quotas

#### Slack
- **Event Notifications** - Work order updates, photo uploads
- **Formatted Messages** - Rich message formatting
- **Error Alerts** - Critical system alerts

### 6. Analytics & Reporting

- **Revenue Metrics** - Monthly/quarterly revenue tracking
- **Status Distribution** - Work order status breakdown
- **Recent Activity** - Real-time activity feed
- **Custom Dashboards** - Role-based dashboard views

## 🛠️ Development Guide

### Backend Development

#### Adding a New Domain

1. Create domain directory structure:
```bash
mkdir -p backend/app/domains/new_domain
cd backend/app/domains/new_domain
```

2. Create domain files:
```python
# models.py - Database models
from sqlalchemy import Column, String
from app.core.database import Base

class NewModel(Base):
    __tablename__ = "new_models"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)

# schemas.py - Pydantic schemas
from pydantic import BaseModel

class NewModelCreate(BaseModel):
    name: str

# repository.py - Data access layer
from app.common.base_repository import BaseRepository

class NewModelRepository(BaseRepository[NewModel]):
    pass

# service.py - Business logic
class NewModelService:
    def __init__(self, db: Session):
        self.repo = NewModelRepository(db)
    
    def create(self, data: NewModelCreate):
        return self.repo.create(data.dict())

# api.py - REST endpoints
from fastapi import APIRouter, Depends

router = APIRouter()

@router.post("/")
async def create_new_model(data: NewModelCreate):
    # Implementation
    pass
```

3. Register router in `main.py`:
```python
from app.domains.new_domain.api import router as new_domain_router
app.include_router(new_domain_router, prefix="/api/new-domain", tags=["New Domain"])
```

#### Database Migrations

```bash
# Create a new migration
alembic revision --autogenerate -m "Add new table"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

### Frontend Development

#### Adding a New Page with Lazy Loading

1. Create page component:
```typescript
// src/pages/NewPage.tsx
import React from 'react';
import { Typography } from 'antd';

const NewPage: React.FC = () => {
  return (
    <div>
      <Typography.Title>New Page</Typography.Title>
    </div>
  );
};

export default NewPage;
```

2. Add to router in `App.tsx`:
```typescript
// Add lazy import at top
const NewPage = lazy(() => import('./pages/NewPage'));

// Add route
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

#### Adding a New API Service

```typescript
// src/services/newService.ts
import api from './api';

export const newService = {
  getAll: async () => {
    const response = await api.get('/api/new-domain');
    return response.data;
  },
  
  create: async (data: any) => {
    const response = await api.post('/api/new-domain', data);
    return response.data;
  }
};
```

### Code Style Guidelines

#### Backend (Python)
- Follow PEP 8
- Use type hints
- Maximum line length: 100 characters
- Use descriptive variable names
- Add docstrings to all public functions

#### Frontend (TypeScript)
- Use functional components with hooks
- Prefer `const` over `let`
- Use TypeScript interfaces for props
- Keep components focused (Single Responsibility)
- Use React Query for API state

## 🧪 Testing

### Backend Tests

```bash
cd backend

# Run all tests
pytest

# Run specific test file
pytest tests/test_estimate_service.py

# Run with coverage
pytest --cov=app tests/
```

### Frontend Tests

```bash
cd frontend

# Run tests
npm test

# Run with coverage
npm test -- --coverage
```

## 📦 Production Deployment

### Docker Deployment

1. **Build images:**
```bash
docker-compose build
```

2. **Configure production environment:**
```bash
# Create production .env files
cp backend/.env.example backend/.env.production
cp frontend/.env.example frontend/.env.production
# Edit with production values
```

3. **Deploy:**
```bash
docker-compose up -d
```

### Manual Deployment

#### Backend (FastAPI)

```bash
# Install production dependencies
pip install -r requirements.txt

# Run with Gunicorn
gunicorn app.main:app \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000
```

#### Frontend (React)

```bash
# Build for production
npm run build

# Serve with nginx or similar
# Copy build/ directory to web server
```

### Environment Checklist

- [ ] Set `DEBUG=False` in backend
- [ ] Configure production database
- [ ] Set up SSL/TLS certificates
- [ ] Configure firewall rules
- [ ] Set up backup system
- [ ] Configure monitoring (Sentry, etc.)
- [ ] Set up logging aggregation
- [ ] Configure rate limiting
- [ ] Set up CDN for static assets
- [ ] Enable database connection pooling

## 📖 API Documentation

Once the backend is running, comprehensive API documentation is available at:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### Key API Endpoints

#### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token

#### Estimates
- `GET /api/estimates` - List estimates
- `POST /api/estimates` - Create estimate
- `GET /api/estimates/{id}` - Get estimate details
- `PUT /api/estimates/{id}` - Update estimate
- `GET /api/estimates/{id}/pdf` - Generate PDF

#### Work Orders
- `GET /api/work-orders` - List work orders
- `POST /api/work-orders` - Create work order
- `PUT /api/work-orders/{id}` - Update work order
- `POST /api/work-orders/{id}/photos` - Upload photos

#### Water Mitigation
- `GET /api/water-mitigation` - List water mitigation jobs
- `POST /api/water-mitigation` - Create new job
- `GET /api/water-mitigation/{id}` - Get job details
- `POST /api/water-mitigation/{id}/photos` - Upload photos

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

# Run diagnostic script
cd backend
python scripts/quick_check.py
```

#### Database migration fails
```bash
# Reset database (CAUTION: destroys data)
alembic downgrade base
alembic upgrade head

# Check migration history
alembic history
alembic current
```

## 📝 Contributing

### Branch Strategy
- `main` - Production-ready code
- `develop` - Development branch
- `feature/*` - Feature branches
- `hotfix/*` - Emergency fixes

### Commit Message Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Example:
```
feat(water-mitigation): add CompanyCam auto-sync

- Implement webhook handler for photo.created events
- Add address matching algorithm
- Add Slack notifications for new photos

Closes #123
```

## 📄 License

Copyright © 2024 MJ Estimate. All rights reserved.

## 🤝 Support

For support, please contact the development team or create an issue in the repository.

---

**Built with ❤️ for insurance restoration contractors**
