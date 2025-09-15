"""
Work Order service for business logic
"""

from typing import Dict, List, Optional, Any
import logging
from datetime import datetime
from uuid import UUID

from app.common.base_service import BaseService
from .repository import get_work_order_repository
from .models import WorkOrder, WorkOrderStatus
from .schemas import WorkOrderCreate, WorkOrderUpdate, WorkOrderFilter

logger = logging.getLogger(__name__)


class WorkOrderService(BaseService[WorkOrder, UUID]):
    """
    Service for managing work orders with business logic
    """
    
    def get_repository(self):
        """Get the work order repository"""
        return get_work_order_repository
    
    def _get_repository_instance(self, session):
        """Get repository instance with the given session"""
        return get_work_order_repository(session)
    
    def generate_work_order_number(self, company_id) -> str:
        """
        Generate unique work order number with company code
        Format: WO-[COMPANY_CODE]-YY-NNNN
        
        Args:
            company_id: Company UUID
            
        Returns:
            Generated work order number
        """
        try:
            session = self.database.get_session()
            try:
                # Get company code
                from app.domains.company.repository import CompanyRepository
                company_repo = CompanyRepository(session)
                
                # Convert company_id to string if it's a UUID object
                company_id_str = str(company_id) if hasattr(company_id, 'hex') else company_id
                
                # Debug logging
                logger.info(f"Generating work order number for company_id: {company_id_str} (type: {type(company_id)})")
                
                company = company_repo.get_by_id(company_id_str)
                logger.info(f"Company data retrieved: {company}")
                
                company_code = "XX"  # Default if no company code
                if company and company.get('company_code'):
                    company_code = company['company_code'].upper()
                    logger.info(f"Using company_code from database: {company_code}")
                elif company and company.get('name'):
                    # If no company_code, try to generate from company name
                    # Take first 2-3 characters of company name
                    name_parts = company['name'].strip().upper().split()
                    if len(name_parts) == 1:
                        # Single word company name - take first 3 chars
                        company_code = name_parts[0][:3] if len(name_parts[0]) >= 3 else name_parts[0]
                    else:
                        # Multiple words - take first letter of each word (up to 3)
                        company_code = ''.join([part[0] for part in name_parts[:3]])
                    logger.info(f"Generated company_code from name: {company_code}")
                else:
                    logger.warning(f"No company found or no company_code/name available for company_id: {company_id}")
                
                # Get current year
                current_year = datetime.now().year
                year_suffix = str(current_year)[2:]  # Last 2 digits
                
                # Find the highest existing number for this company and year
                repository = self._get_repository_instance(session)
                # Get work orders for this company to find the latest number
                all_wos = repository.get_by_company(company_id_str)
                
                next_number = 1
                if all_wos:
                    # Filter work orders for current year and extract highest number
                    for wo in all_wos:
                        wo_num = wo.get('work_order_number', '')
                        # Parse format: WO-COMPANY_CODE-YY-NNNN
                        parts = wo_num.split('-')
                        if len(parts) >= 4:
                            try:
                                # Check if it's from the current year and same company code
                                if parts[1] == company_code and parts[2] == year_suffix:
                                    num = int(parts[3])
                                    next_number = max(next_number, num + 1)
                            except (ValueError, IndexError):
                                pass
                
                # Format: WO-COMPANY_CODE-YY-NNNN
                work_order_number = f"WO-{company_code}-{year_suffix}-{next_number:04d}"
                logger.info(f"Generated work order number: {work_order_number}")
                
                # Ensure uniqueness
                counter = 0
                base_number = work_order_number
                while self.work_order_number_exists(work_order_number):
                    counter += 1
                    work_order_number = f"{base_number}-{counter}"
                    logger.info(f"Work order number already exists, trying: {work_order_number}")
                
                logger.info(f"Final work order number: {work_order_number}")
                return work_order_number
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Error generating work order number: {e}")
            # Fallback to UUID-based number
            import uuid
            year_suffix = str(datetime.now().year)[2:]
            return f"WO-XX-{year_suffix}-{str(uuid.uuid4())[:8].upper()}"
    
    def work_order_number_exists(self, work_order_number: str) -> bool:
        """
        Check if work order number already exists
        
        Args:
            work_order_number: Work order number to check
            
        Returns:
            True if exists, False otherwise
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.work_order_number_exists(work_order_number)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error checking work order number existence: {e}")
            return False
    
    def create_work_order(self, work_order_data: WorkOrderCreate) -> Dict[str, Any]:
        """
        Create a new work order with auto-generated work order number
        
        Args:
            work_order_data: Work order creation data
            
        Returns:
            Created work order dictionary
        """
        try:
            # Convert Pydantic model to dict
            data = work_order_data.dict()
            
            # Generate work order number if not provided
            if not data.get('work_order_number'):
                data['work_order_number'] = self.generate_work_order_number(data['company_id'])
            
            # created_by_staff_id should be provided by the API endpoint
            # No default staff ID to avoid foreign key constraint errors
            
            # Set initial status
            data['status'] = WorkOrderStatus.DRAFT
            
            # Calculate costs if trades are provided
            if data.get('trades'):
                # Get tax settings from data, default to False
                apply_tax = data.get('apply_tax', False)
                tax_rate = None
                if data.get('tax_rate'):
                    try:
                        tax_rate = float(data['tax_rate'])
                    except (ValueError, TypeError):
                        tax_rate = None
                
                cost_breakdown = self.calculate_cost(
                    data.get('document_type'),
                    data.get('trades', []),
                    data['company_id'],
                    data.get('additional_costs', []),
                    apply_tax=apply_tax,
                    tax_rate=tax_rate
                )
                
                # Store calculated costs
                data['base_cost'] = str(cost_breakdown['base_cost'])
                data['final_cost'] = str(cost_breakdown['final_cost'])
                data['tax_amount'] = str(cost_breakdown['tax_amount'])
                data['discount_amount'] = str(cost_breakdown['discount_amount'])
            else:
                # Set default values if no trades
                data['base_cost'] = '0.0'
                data['final_cost'] = '0.0'
                data['tax_amount'] = '0.0'
                data['discount_amount'] = '0.0'
            
            # Create the work order
            return self.create(data)
            
        except Exception as e:
            logger.error(f"Error creating work order: {e}")
            raise
    
    def update_work_order_status(self, work_order_id: UUID, status: WorkOrderStatus, 
                                staff_id: UUID, notes: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Update work order status with timestamp tracking
        
        Args:
            work_order_id: Work order ID
            status: New status
            staff_id: Staff member making the change
            notes: Optional notes about the status change
            
        Returns:
            Updated work order or None if not found
        """
        try:
            update_data = {
                'status': status,
                'updated_at': datetime.utcnow()
            }
            
            # Add timestamp based on status
            if status == WorkOrderStatus.IN_PROGRESS and not self.get_by_id(work_order_id).get('actual_start_date'):
                update_data['actual_start_date'] = datetime.utcnow()
            elif status == WorkOrderStatus.COMPLETED:
                update_data['actual_end_date'] = datetime.utcnow()
                if notes:
                    update_data['completion_notes'] = notes
            
            return self.update(work_order_id, update_data)
            
        except Exception as e:
            logger.error(f"Error updating work order status: {e}")
            raise
    
    def get_work_orders_with_filters(self, filters: WorkOrderFilter) -> Dict[str, Any]:
        """
        Get work orders with advanced filtering
        
        Args:
            filters: Filter parameters
            
        Returns:
            Dictionary with work orders and metadata
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                
                # Convert Pydantic filter to dict, excluding None values
                filter_dict = filters.dict(exclude_none=True)
                
                # Use get_all with filters
                work_orders = repository.get_all(filters=filter_dict)
                
                return {
                    'work_orders': work_orders,
                    'total': len(work_orders),
                    'filters_applied': filter_dict
                }
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Error getting work orders with filters: {e}")
            raise
    
    def get_work_orders_by_company(self, company_id: UUID, 
                                  status: Optional[WorkOrderStatus] = None) -> List[Dict[str, Any]]:
        """
        Get all work orders for a specific company
        
        Args:
            company_id: Company UUID
            status: Optional status filter
            
        Returns:
            List of work order dictionaries
        """
        try:
            filters = {'company_id': company_id}
            if status:
                filters['status'] = status
            
            return self.get_all(filters=filters, order_by='-created_at')
            
        except Exception as e:
            logger.error(f"Error getting work orders by company: {e}")
            raise
    
    def get_work_orders_by_staff(self, staff_id: UUID, 
                                assigned_only: bool = False) -> List[Dict[str, Any]]:
        """
        Get work orders associated with a staff member
        
        Args:
            staff_id: Staff member UUID
            assigned_only: If True, only return assigned work orders
            
        Returns:
            List of work order dictionaries
        """
        try:
            if assigned_only:
                filters = {'assigned_to_staff_id': staff_id}
            else:
                # Get work orders created by or assigned to the staff member
                session = self.database.get_session()
                try:
                    repository = self._get_repository_instance(session)
                    return repository.get_work_orders_by_staff(staff_id)
                finally:
                    session.close()
            
            return self.get_all(filters=filters, order_by='-created_at')
            
        except Exception as e:
            logger.error(f"Error getting work orders by staff: {e}")
            raise
    
    def calculate_cost(self, document_type: str, trade_ids: List[str], company_id: str, 
                      additional_costs: List[Dict[str, Any]] = None, apply_tax: bool = False, tax_rate: Optional[float] = None) -> Dict[str, Any]:
        """
        Calculate work order cost based on document type, trades, and additional costs
        
        Args:
            document_type: Type of document
            trade_ids: List of trade IDs
            company_id: Company ID
            additional_costs: List of additional cost items
            
        Returns:
            Cost breakdown dictionary
        """
        logger.info(f"calculate_cost called with trade_ids: {trade_ids}, company_id: {company_id}")
        try:
            session = self.database.get_session()
            try:
                base_cost = 0.0
                trade_costs = []
                
                # Get base cost from document type
                if document_type:
                    from app.domains.document_types import service as dt_service
                    
                    # Get all document types and find the matching one
                    document_types = dt_service.get_document_types(session, active_only=True)
                    for doc_type in document_types:
                        # Match by code (e.g., 'work_order', 'estimate', etc.)
                        if hasattr(doc_type, 'code') and doc_type.code == document_type:
                            if hasattr(doc_type, 'base_price') and doc_type.base_price is not None:
                                try:
                                    base_cost = float(doc_type.base_price)
                                    logger.info(f"Document type {document_type} base_price: {base_cost}")
                                except (ValueError, TypeError):
                                    base_cost = 0.0
                            break
                        # Also try matching by name
                        elif hasattr(doc_type, 'name') and doc_type.name.lower().replace(' ', '_') == document_type:
                            if hasattr(doc_type, 'base_price') and doc_type.base_price is not None:
                                try:
                                    base_cost = float(doc_type.base_price)
                                    logger.info(f"Document type {document_type} base_price: {base_cost}")
                                except (ValueError, TypeError):
                                    base_cost = 0.0
                            break
                    
                    if base_cost == 0.0:
                        logger.warning(f"No base_price found for document type: {document_type}")
                
                # Get trades (for information only, not for cost calculation)
                if trade_ids:
                    if 'dt_service' not in locals():
                        from app.domains.document_types import service as dt_service
                    from uuid import UUID as uuid_UUID
                    
                    for trade_id in trade_ids:
                        logger.info(f"Fetching trade with ID: {trade_id}")
                        # Convert string to UUID object if needed
                        if isinstance(trade_id, str):
                            try:
                                trade_uuid = uuid_UUID(trade_id)
                            except ValueError:
                                logger.error(f"Invalid UUID format: {trade_id}")
                                continue
                        else:
                            trade_uuid = trade_id
                        
                        trade = dt_service.get_trade(session, trade_uuid)
                        logger.info(f"Trade data: {trade}")
                        if trade:
                            trade_name = trade.name if hasattr(trade, 'name') else 'Unknown'
                            logger.info(f"Trade {trade_uuid} ({trade_name}) added to list")
                            trade_costs.append({
                                'id': str(trade_uuid),
                                'name': trade_name,
                                'cost': 0  # Cost comes from document type, not trade
                            })
                        else:
                            logger.warning(f"Trade not found with ID: {trade_uuid}")
                
                # Calculate additional costs
                additional_costs_total = 0.0
                additional_costs_detail = []
                if additional_costs:
                    for cost in additional_costs:
                        cost_amount = float(cost.get('amount', 0))
                        additional_costs_total += cost_amount
                        detail_item = {
                            'name': cost.get('name', 'Unknown'),
                            'amount': cost_amount,
                            'description': cost.get('description', '')
                        }
                        # Only add type if it exists (for template items)
                        if cost.get('type'):
                            detail_item['type'] = cost['type']
                        additional_costs_detail.append(detail_item)
                
                # Calculate subtotal (trades + additional costs)
                subtotal = base_cost + additional_costs_total
                
                # Calculate tax only if apply_tax is True
                if apply_tax:
                    # Use provided tax_rate or default to 8.1%
                    actual_tax_rate = tax_rate if tax_rate is not None else 0.081
                    tax_amount = subtotal * actual_tax_rate
                else:
                    actual_tax_rate = 0.0
                    tax_amount = 0.0
                
                # Calculate final cost
                final_cost = subtotal + tax_amount
                
                logger.info(f"Cost calculation summary:")
                logger.info(f"  - Base cost (from trades): ${base_cost}")
                logger.info(f"  - Additional costs total: ${additional_costs_total}")
                logger.info(f"  - Subtotal: ${subtotal}")
                logger.info(f"  - Tax amount ({actual_tax_rate * 100}%): ${tax_amount}")
                logger.info(f"  - Final cost: ${final_cost}")
                
                return {
                    'base_cost': base_cost,
                    'additional_costs': additional_costs_detail,
                    'additional_costs_total': additional_costs_total,
                    'subtotal': subtotal,
                    'tax_amount': tax_amount,
                    'tax_rate': actual_tax_rate,
                    'discount_amount': 0.0,
                    'final_cost': final_cost,
                    'trade_costs': trade_costs,
                    'currency': 'USD'
                }
                
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Error calculating cost: {e}")
            # Return default cost breakdown on error
            return {
                'base_cost': 0.0,
                'tax_amount': 0.0,
                'tax_rate': 0.081,
                'discount_amount': 0.0,
                'final_cost': 0.0,
                'trade_costs': [],
                'currency': 'USD'
            }
    
    def search_work_orders(self, search_term: str) -> List[Dict[str, Any]]:
        """
        Search work orders by work order number or address fields
        
        Args:
            search_term: Search term to match against work order number and address fields
            
        Returns:
            List of matching work order dictionaries
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.search_orders(search_term)
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Error searching work orders: {e}")
            raise
    
    def get_dashboard_stats(self, company_id: Optional[UUID] = None) -> Dict[str, Any]:
        """
        Get dashboard statistics for work orders
        
        Args:
            company_id: Optional company filter
            
        Returns:
            Dictionary with various statistics
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.get_dashboard_stats(company_id)
            finally:
                session.close()
                
        except Exception as e:
            logger.error(f"Error getting dashboard stats: {e}")
            raise
    
    def get_all(self, filters: Optional[Dict[str, Any]] = None, 
                order_by: Optional[str] = None, 
                limit: Optional[int] = None, 
                offset: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Get all work orders with document type names enriched
        
        Args:
            filters: Optional filter criteria
            order_by: Optional ordering
            limit: Optional result limit
            offset: Optional result offset
            
        Returns:
            List of work order dictionaries with document_type_name field
        """
        try:
            # Get work orders from parent class
            work_orders = super().get_all(filters=filters, order_by=order_by, limit=limit, offset=offset)
            
            # Enrich each work order with document type name
            for work_order in work_orders:
                self.enrich_document_type_name(work_order)
                # Also ensure cost fields
                self.ensure_cost_fields(work_order)
            
            return work_orders
            
        except Exception as e:
            logger.error(f"Error getting all work orders: {e}")
            raise
    
    def get_by_id(self, entity_id) -> Optional[Dict[str, Any]]:
        """
        Get work order by ID with cost fields ensured
        
        Args:
            entity_id: Work order ID
            
        Returns:
            Work order dictionary with calculated costs or None if not found
        """
        try:
            work_order = super().get_by_id(entity_id)
            if work_order:
                # Always ensure cost fields are calculated
                work_order = self.ensure_cost_fields(work_order)
                # Add document type name
                work_order = self.enrich_document_type_name(work_order)
            return work_order
        except Exception as e:
            logger.error(f"Error getting work order by ID {entity_id}: {e}")
            return None
    
    def enrich_document_type_name(self, work_order: Dict[str, Any]) -> Dict[str, Any]:
        """
        Enrich work order with document type name from document types table
        
        Args:
            work_order: Work order dictionary
            
        Returns:
            Work order with document_type_name field added
        """
        try:
            if work_order and work_order.get('document_type'):
                doc_type_code = work_order['document_type']
                logger.info(f"Looking up document type with code: {doc_type_code}")
                
                session = self.database.get_session()
                try:
                    from app.domains.document_types import service as dt_service
                    
                    # Get all document types (including inactive) and find the matching one by code
                    document_types = dt_service.get_document_types(session, active_only=False)
                    logger.info(f"Found {len(document_types)} document types in database")
                    
                    found = False
                    for doc_type in document_types:
                        if hasattr(doc_type, 'code'):
                            logger.debug(f"Comparing '{doc_type.code}' with '{doc_type_code}'")
                            # Case-insensitive comparison for better matching
                            if doc_type.code.upper() == doc_type_code.upper():
                                work_order['document_type_name'] = doc_type.name
                                logger.info(f"Found document type name: {doc_type.name} for code: {doc_type_code}")
                                found = True
                                break
                    
                    # If no match found, use the code as the name
                    if not found:
                        logger.warning(f"No document type found for code: {doc_type_code}")
                        work_order['document_type_name'] = work_order['document_type']
                        
                finally:
                    session.close()
                    
        except Exception as e:
            logger.error(f"Error enriching document type name: {e}")
            # On error, use the code as the name
            if work_order and work_order.get('document_type'):
                work_order['document_type_name'] = work_order['document_type']
                
        return work_order
    
    def ensure_cost_fields(self, work_order: Dict[str, Any]) -> Dict[str, Any]:
        """
        Ensure work order has cost fields calculated
        
        Args:
            work_order: Work order dictionary
            
        Returns:
            Work order with cost fields
        """
        logger.info(f"ensure_cost_fields called for work order {work_order.get('id')}")
        logger.info(f"Trades: {work_order.get('trades')}")
        logger.info(f"Initial base_cost: {work_order.get('base_cost')} (type: {type(work_order.get('base_cost'))})")
        logger.info(f"Initial final_cost: {work_order.get('final_cost')} (type: {type(work_order.get('final_cost'))})")
        
        # Convert cost fields to float first for proper comparison
        base_cost_value = 0.0
        final_cost_value = 0.0
        
        if work_order.get('base_cost') is not None:
            try:
                if isinstance(work_order['base_cost'], str):
                    base_cost_value = float(work_order['base_cost'])
                else:
                    base_cost_value = float(work_order['base_cost'] or 0.0)
            except (ValueError, TypeError):
                base_cost_value = 0.0
        
        if work_order.get('final_cost') is not None:
            try:
                if isinstance(work_order['final_cost'], str):
                    final_cost_value = float(work_order['final_cost'])
                else:
                    final_cost_value = float(work_order['final_cost'] or 0.0)
            except (ValueError, TypeError):
                final_cost_value = 0.0
        
        logger.info(f"Converted base_cost_value: {base_cost_value}, final_cost_value: {final_cost_value}")
        
        # Always recalculate if trades exist to ensure accuracy
        if work_order.get('trades'):
            logger.info(f"Recalculating costs for work order {work_order.get('id')} with trades: {work_order.get('trades')}")
            
            # Get tax settings from work order
            apply_tax = work_order.get('apply_tax', False)
            tax_rate = None
            if work_order.get('tax_rate'):
                try:
                    tax_rate = float(work_order['tax_rate'])
                except (ValueError, TypeError):
                    tax_rate = None
            
            cost_breakdown = self.calculate_cost(
                work_order.get('document_type'),
                work_order.get('trades', []),
                work_order.get('company_id'),
                work_order.get('additional_costs', []),
                apply_tax=apply_tax,
                tax_rate=tax_rate
            )
            logger.info(f"Calculated cost breakdown: {cost_breakdown}")
            
            work_order['base_cost'] = cost_breakdown['base_cost']
            work_order['final_cost'] = cost_breakdown['final_cost']
            work_order['tax_amount'] = cost_breakdown['tax_amount']
            work_order['discount_amount'] = cost_breakdown['discount_amount']
        else:
            # No trades, ensure fields exist with 0 values
            work_order['base_cost'] = 0.0
            work_order['final_cost'] = 0.0
            work_order['tax_amount'] = 0.0
            work_order['discount_amount'] = 0.0
        
        # Ensure all cost fields are numeric (not strings)
        for field in ['base_cost', 'final_cost', 'tax_amount', 'discount_amount']:
            if field not in work_order or work_order[field] is None:
                work_order[field] = 0.0
            elif isinstance(work_order[field], str):
                try:
                    work_order[field] = float(work_order[field])
                except (ValueError, TypeError):
                    work_order[field] = 0.0
            else:
                # Ensure it's a float, not Decimal or other type
                try:
                    work_order[field] = float(work_order[field])
                except (ValueError, TypeError):
                    work_order[field] = 0.0
        
        logger.info(f"Final base_cost: {work_order.get('base_cost')} (type: {type(work_order.get('base_cost'))})")
        logger.info(f"Final final_cost: {work_order.get('final_cost')} (type: {type(work_order.get('final_cost'))})")
        
        return work_order
    
    def _validate_create_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate work order creation data"""
        # Ensure required fields
        if not data.get('client_name'):
            raise ValueError("Client name is required")
        
        if not data.get('work_order_number'):
            data['work_order_number'] = self.generate_work_order_number(data['company_id'])
        
        return data
    
    def _validate_update_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate work order update data"""
        # Remove fields that shouldn't be updated directly
        protected_fields = ['id', 'created_at', 'created_by_staff_id']
        for field in protected_fields:
            data.pop(field, None)
        
        return data