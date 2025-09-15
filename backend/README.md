# MJ Estimate Backend API

FastAPI backend for MJ Estimate Generator application.

## 📁 Directory Structure

```
backend/
├── app/
│   ├── api/            # API route endpoints
│   │   ├── companies.py
│   │   ├── documents.py
│   │   ├── estimates.py
│   │   └── invoices.py
│   ├── core/           # Core configuration and utilities
│   │   ├── config.py   # Settings and configuration
│   │   └── database.py # Database connection
│   ├── schemas/        # Pydantic models for request/response
│   │   ├── company.py
│   │   ├── document.py
│   │   ├── estimate.py
│   │   └── invoice.py
│   ├── services/       # Business logic layer
│   │   ├── company_service.py
│   │   ├── document_service.py
│   │   ├── estimate_service.py
│   │   └── invoice_service.py
│   └── main.py        # FastAPI application entry point
├── run.py             # Server startup script
├── requirements.txt   # Python dependencies
└── .env.example      # Environment variables template
```

## 🚀 Setup

### 1. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required variables:
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_KEY`: Your Supabase service key
- `SECRET_KEY`: Secret key for JWT tokens

### 3. Run the Server

```bash
python run.py
```

The API will be available at `http://localhost:8000`

## 📚 API Documentation

Once the server is running, you can access:
- Interactive API docs: `http://localhost:8000/docs`
- Alternative API docs: `http://localhost:8000/redoc`

## 🔗 API Endpoints

### Companies
- `GET /api/companies` - List all companies
- `GET /api/companies/{id}` - Get company by ID
- `POST /api/companies` - Create new company
- `PUT /api/companies/{id}` - Update company
- `DELETE /api/companies/{id}` - Delete company
- `POST /api/companies/{id}/logo` - Upload company logo

### Documents (Combined)
- `GET /api/documents` - List documents with filters
- `GET /api/documents/{id}` - Get document by ID
- `DELETE /api/documents/{id}` - Delete document
- `POST /api/documents/{id}/duplicate` - Duplicate document
- `GET /api/documents/{id}/pdf` - Generate PDF
- `POST /api/documents/{id}/send` - Send via email
- `POST /api/documents/export` - Export to Excel

### Estimates
- `POST /api/estimates` - Create new estimate
- `GET /api/estimates/{id}` - Get estimate by ID
- `PUT /api/estimates/{id}` - Update estimate
- `DELETE /api/estimates/{id}` - Delete estimate

### Invoices
- `POST /api/invoices` - Create new invoice
- `GET /api/invoices/{id}` - Get invoice by ID
- `PUT /api/invoices/{id}` - Update invoice
- `DELETE /api/invoices/{id}` - Delete invoice

## 🏗️ Architecture

The backend follows a layered architecture:

1. **API Layer** (`app/api/`): FastAPI route handlers
2. **Schema Layer** (`app/schemas/`): Pydantic models for validation
3. **Service Layer** (`app/services/`): Business logic
4. **Module Layer** (existing `modules/`): Database operations

This structure ensures:
- Clear separation of concerns
- Easy testing and maintenance
- Reuse of existing business logic
- Type safety with Pydantic

## 🔄 Integration with Existing Code

The backend reuses existing Python modules:
- `modules/company_module.py`
- `modules/estimate_module.py`
- `modules/invoice_module.py`
- `modules/estimate_item_module.py`
- `modules/invoice_item_module.py`
- `utils/db.py`
- `pdf_generator.py`

This ensures compatibility with the existing Streamlit application.

## 🧪 Testing

Run tests with pytest:

```bash
pytest
```

## 🚀 Production Deployment

For production deployment:

1. Set `DEBUG=False` in `.env`
2. Use a production ASGI server like Gunicorn:
   ```bash
   gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker
   ```
3. Set up proper logging and monitoring
4. Use environment-specific configuration
5. Implement rate limiting and security headers