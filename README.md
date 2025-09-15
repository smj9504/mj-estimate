# MJ React App - Modern Estimate & Invoice Management

A modern React + FastAPI application for professional insurance estimates, invoices, and document management.

## Architecture

**Modern Stack**:
- **Backend**: FastAPI with domain-driven design
- **Frontend**: React 18 + TypeScript + Ant Design
- **Database**: PostgreSQL with Supabase
- **State Management**: Zustand + React Query

## Quick Start

### Prerequisites
- Node.js 16+ 
- Python 3.9+
- PostgreSQL (or use Docker)

### Development Setup

1. **Start all servers**:
```bash
start_servers.bat
```

2. **Manual setup**:
```bash
# Backend (Terminal 1)
cd backend
python -m uvicorn app.main:app --reload --port 8000

# Frontend (Terminal 2) 
cd frontend
npm install
npm start
```

3. **Docker development**:
```bash
docker-compose -f docker-compose.dev.yml up
```

## Application URLs

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Database Admin**: http://localhost:8080 (via Docker)

## Backend Architecture

**Domain Structure**:
- `domains/auth/` - Authentication & JWT
- `domains/company/` - Company management
- `domains/invoice/` - Invoice creation & management
- `domains/estimate/` - Estimate workflows
- `domains/work_order/` - Work order lifecycle
- `domains/staff/` - User & permission management

**Key Features**:
- Domain-driven design
- JWT authentication
- Automatic API documentation
- Database migrations
- File upload handling

## Frontend Architecture  

**Key Features**:
- Modern React with hooks
- TypeScript for type safety
- Ant Design UI components
- Korean localization support
- Protected routes
- Real-time state management

**Component Structure**:
- `pages/` - Main application pages
- `components/` - Reusable UI components
- `services/` - API integration layer
- `contexts/` - Global state management

## Available Scripts

### Backend
```bash
cd backend
uvicorn app.main:app --reload  # Development server
pytest                         # Run tests
```

### Frontend
```bash
cd frontend
npm start        # Development server
npm test         # Run tests  
npm run build    # Production build
```

## Environment Configuration

Create `.env` files in both backend and frontend directories with your configuration.

## Database Setup

The application uses PostgreSQL. Use Docker for easy setup:
```bash
docker-compose -f docker-compose.dev.yml up postgres-dev
```

## Deployment

Production deployment via Docker:
```bash
docker-compose -f docker-compose.prod.yml up
```