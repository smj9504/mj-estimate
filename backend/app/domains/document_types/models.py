"""
Document Types and Trades database models
"""

from sqlalchemy import Column, String, Text, DateTime, Boolean, ForeignKey, Enum, DECIMAL, Integer, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import enum

from app.core.database_factory import Base


class FeeRuleType(str, enum.Enum):
    """Fee rule type enumeration"""
    FLAT = "flat"  # Flat rate fee
    TIERED = "tiered"  # Tiered fee based on quantity
    LOCATION_BASED = "location_based"  # Based on number of locations
    ADDON = "addon"  # Additional service addon


class MeasurementReportProvider(str, enum.Enum):
    """Measurement report provider enumeration"""
    EAGLEVIEW = "eagleview"
    ROOFR = "roofr"
    HOVER = "hover"
    CUSTOM = "custom"


class DocumentType(Base):
    """Document Type model with complex pricing rules"""
    __tablename__ = "document_types"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Basic Information
    name = Column(String(100), unique=True, nullable=False)
    code = Column(String(20), unique=True, nullable=False)  # Short code for reference
    description = Column(Text)
    category = Column(String(50))  # estimate, report, invoice, etc.
    
    # Base Fee (service fee we charge customers)
    base_fee = Column(DECIMAL(10, 2), default=0.00)
    
    # Complex Fee Rules (JSON structure for flexibility)
    # Example structure:
    # {
    #   "location_rules": {
    #     "base_locations": 3,
    #     "additional_location_fee": 25.00,
    #     "additional_location_grouping": 3
    #   },
    #   "addons": [
    #     {"name": "cabinet_estimate", "fee": 30.00}
    #   ],
    #   "volume_discounts": [
    #     {"min_quantity": 10, "discount_percent": 10}
    #   ]
    # }
    fee_rules = Column(JSON, default={})
    
    # Requirements
    requires_measurement_report = Column(Boolean, default=False)
    measurement_report_providers = Column(JSON, default=[])  # List of allowed providers
    
    # Template and Form Settings
    template_name = Column(String(100))  # PDF template to use
    required_fields = Column(JSON, default=[])  # List of required fields for this document type
    optional_fields = Column(JSON, default=[])  # List of optional fields
    
    # Workflow Settings
    requires_approval = Column(Boolean, default=False)
    approval_levels = Column(Integer, default=1)  # Number of approval levels needed
    estimated_hours = Column(DECIMAL(5, 2))  # Estimated hours to complete
    
    # Status and Availability
    is_active = Column(Boolean, default=True)
    is_available_online = Column(Boolean, default=True)  # Can be ordered through self-service
    
    # Display Settings
    icon = Column(String(50))  # Icon class or emoji
    color = Column(String(7))  # Hex color code for UI
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True))
    updated_by = Column(UUID(as_uuid=True))
    
    # Relationships
    fee_rules_rel = relationship("FeeRule", back_populates="document_type", cascade="all, delete-orphan")
    work_order_document_types = relationship("WorkOrderDocumentType", back_populates="document_type", cascade="all, delete-orphan")
    
    def calculate_fee(self, **kwargs):
        """Calculate service fee based on complex rules"""
        total_fee = float(self.base_fee)
        
        if self.fee_rules:
            # Location-based fees
            if 'location_rules' in self.fee_rules and 'locations' in kwargs:
                location_rules = self.fee_rules['location_rules']
                locations = kwargs['locations']
                base_locations = location_rules.get('base_locations', 0)
                
                if locations > base_locations:
                    additional = locations - base_locations
                    grouping = location_rules.get('additional_location_grouping', 1)
                    groups = (additional + grouping - 1) // grouping  # Ceiling division
                    additional_fee = location_rules.get('additional_location_fee', 0)
                    total_fee += groups * additional_fee
            
            # Addon fees
            if 'addons' in self.fee_rules and 'selected_addons' in kwargs:
                addons = self.fee_rules['addons']
                selected = kwargs['selected_addons']
                for addon in addons:
                    if addon['name'] in selected:
                        total_fee += addon.get('fee', 0)
            
            # Volume discounts
            if 'volume_discounts' in self.fee_rules and 'quantity' in kwargs:
                discounts = self.fee_rules['volume_discounts']
                quantity = kwargs['quantity']
                for discount in sorted(discounts, key=lambda x: x['min_quantity'], reverse=True):
                    if quantity >= discount['min_quantity']:
                        discount_percent = discount.get('discount_percent', 0)
                        total_fee *= (1 - discount_percent / 100)
                        break

        return total_fee
    
    def __str__(self):
        return f"{self.name} (${self.base_fee})"
    
    def __repr__(self):
        return f"<DocumentType(id={self.id}, name={self.name}, base_fee={self.base_fee})>"


class Trade(Base):
    """Trade model (types of work/services)"""
    __tablename__ = "trades"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Basic Information
    name = Column(String(100), unique=True, nullable=False)
    code = Column(String(20), unique=True, nullable=False)  # Short code for reference
    description = Column(Text)
    category = Column(String(50))  # construction, maintenance, specialty, etc.
    
    # Requirements and Certifications
    requires_license = Column(Boolean, default=False)
    license_type = Column(String(100))
    requires_insurance = Column(Boolean, default=True)
    insurance_minimum = Column(DECIMAL(12, 2))  # Minimum insurance coverage required
    
    # Default Settings (can be overridden per work order)
    default_markup = Column(DECIMAL(5, 2), default=0)  # Default markup percentage
    default_hourly_rate = Column(DECIMAL(8, 2))  # Default hourly rate if applicable
    
    # Skills and Tools
    required_skills = Column(JSON, default=[])  # List of required skills
    required_tools = Column(JSON, default=[])  # List of required tools
    
    # Display Settings
    is_active = Column(Boolean, default=True)
    icon = Column(String(50))  # Icon class or emoji
    color = Column(String(7))  # Hex color code for UI
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True))
    updated_by = Column(UUID(as_uuid=True))
    
    # Relationships
    work_order_trades = relationship("WorkOrderTrade", back_populates="trade", cascade="all, delete-orphan")
    trade_document_type_configs = relationship("TradeDocumentTypeConfig", back_populates="trade", cascade="all, delete-orphan")
    
    def __str__(self):
        return self.name
    
    def __repr__(self):
        return f"<Trade(id={self.id}, name={self.name}, category={self.category})>"


class FeeRule(Base):
    """Detailed fee rules for document types"""
    __tablename__ = "fee_rules"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Association
    document_type_id = Column(UUID(as_uuid=True), ForeignKey("document_types.id"), nullable=False)
    
    # Rule Definition
    rule_name = Column(String(100), nullable=False)
    rule_type = Column(Enum(FeeRuleType), nullable=False)
    priority = Column(Integer, default=0)  # Higher priority rules apply first
    
    # Rule Parameters (JSON for flexibility)
    # Examples:
    # Flat: {"fee": 50.00}
    # Tiered: {"tiers": [{"min": 0, "max": 3, "fee": 75}, {"min": 4, "max": 6, "fee": 100}]}
    # Location-based: {"base_locations": 3, "fee_per_additional": 25}
    # Addon: {"addon_name": "cabinet_estimate", "fee": 30}
    parameters = Column(JSON, nullable=False)
    
    # Conditions (when this rule applies)
    conditions = Column(JSON, default={})  # e.g., {"min_locations": 4, "has_addon": "cabinet"}
    
    # Validity Period
    valid_from = Column(DateTime)
    valid_to = Column(DateTime)
    
    # Status
    is_active = Column(Boolean, default=True)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    document_type = relationship("DocumentType", back_populates="fee_rules_rel")
    
    def applies_to(self, **context):
        """Check if this rule applies given the context"""
        if not self.is_active:
            return False
        
        # Check validity period
        now = datetime.utcnow()
        if self.valid_from and now < self.valid_from:
            return False
        if self.valid_to and now > self.valid_to:
            return False
        
        # Check conditions
        if self.conditions:
            for key, value in self.conditions.items():
                if key not in context or context[key] != value:
                    return False
        
        return True
    
    def calculate_fee(self, **context):
        """Calculate fee based on this rule"""
        if not self.applies_to(**context):
            return 0
        
        if self.rule_type == FeeRuleType.FLAT:
            return self.parameters.get('fee', 0)
        
        elif self.rule_type == FeeRuleType.TIERED:
            tiers = self.parameters.get('tiers', [])
            quantity = context.get('quantity', 1)
            for tier in tiers:
                if tier['min'] <= quantity <= tier.get('max', float('inf')):
                    return tier['fee']
            return 0
        
        elif self.rule_type == FeeRuleType.LOCATION_BASED:
            locations = context.get('locations', 1)
            base_locations = self.parameters.get('base_locations', 0)
            if locations > base_locations:
                additional = locations - base_locations
                return self.parameters.get('fee_per_additional', 0) * additional
            return 0
        
        elif self.rule_type == FeeRuleType.ADDON:
            selected_addons = context.get('selected_addons', [])
            addon_name = self.parameters.get('addon_name')
            if addon_name in selected_addons:
                return self.parameters.get('fee', 0)
            return 0
        
        return 0
    
    def __repr__(self):
        return f"<FeeRule(id={self.id}, name={self.rule_name}, type={self.rule_type})>"


class MeasurementReportType(Base):
    """Types of measurement reports that can be ordered"""
    __tablename__ = "measurement_report_types"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Basic Information
    name = Column(String(100), nullable=False)
    provider = Column(Enum(MeasurementReportProvider), nullable=False)
    description = Column(Text)
    
    # Fee structure (pass-through or marked up)
    base_cost = Column(DECIMAL(10, 2), default=0.00)  # Our cost
    markup_percent = Column(DECIMAL(5, 2), default=0)  # Markup percentage
    fixed_markup = Column(DECIMAL(10, 2), default=0)  # Fixed markup amount
    
    # Turnaround Time
    standard_turnaround_hours = Column(Integer, default=48)
    rush_turnaround_hours = Column(Integer, default=24)
    rush_fee = Column(DECIMAL(10, 2), default=0)
    
    # Requirements
    required_info = Column(JSON, default=[])  # List of required information fields
    
    # API Configuration (if automated)
    api_endpoint = Column(String(255))
    api_credentials_encrypted = Column(Text)  # Encrypted API credentials
    
    # Status
    is_active = Column(Boolean, default=True)
    is_automated = Column(Boolean, default=False)  # Can be ordered automatically
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def calculate_fee(self, rush=False):
        """Calculate customer fee for the report"""
        base = float(self.base_cost)
        if self.markup_percent:
            base *= (1 + float(self.markup_percent) / 100)
        if self.fixed_markup:
            base += float(self.fixed_markup)
        if rush and self.rush_fee:
            base += float(self.rush_fee)
        return base
    
    def __repr__(self):
        return f"<MeasurementReportType(id={self.id}, name={self.name}, provider={self.provider})>"


class TradeDocumentTypeConfig(Base):
    """Configuration for trade-specific document type pricing"""
    __tablename__ = "trade_document_type_configs"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Association
    trade_id = Column(UUID(as_uuid=True), ForeignKey("trades.id"), nullable=False)
    document_type_id = Column(UUID(as_uuid=True), ForeignKey("document_types.id"), nullable=False)
    
    # Trade-specific fee adjustments
    fee_adjustment = Column(DECIMAL(10, 2), default=0)  # Fixed adjustment
    fee_multiplier = Column(DECIMAL(5, 2), default=1)  # Multiplier for base fee
    
    # Trade-specific requirements
    additional_fields = Column(JSON, default=[])  # Additional required fields for this trade
    estimated_hours = Column(DECIMAL(5, 2))  # Override document type estimated hours
    
    # Status
    is_active = Column(Boolean, default=True)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    trade = relationship("Trade", back_populates="trade_document_type_configs")
    document_type = relationship("DocumentType")
    
    def __repr__(self):
        return f"<TradeDocumentTypeConfig(trade_id={self.trade_id}, document_type_id={self.document_type_id})>"


class WorkOrderDocumentType(Base):
    """Association between work orders and document types"""
    __tablename__ = "work_order_document_types"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Association
    work_order_id = Column(UUID(as_uuid=True), ForeignKey("work_orders.id"), nullable=False)
    document_type_id = Column(UUID(as_uuid=True), ForeignKey("document_types.id"), nullable=False)
    
    # Service fees at time of order
    quantity = Column(Integer, default=1)
    unit_fee = Column(DECIMAL(10, 2), nullable=False)
    total_fee = Column(DECIMAL(10, 2), nullable=False)
    
    # Additional details
    locations_count = Column(Integer)
    selected_addons = Column(JSON, default=[])
    measurement_report_id = Column(UUID(as_uuid=True))  # If measurement report was ordered
    
    # Status
    status = Column(String(50), default="pending")  # pending, in_progress, completed
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)
    
    # Relationships
    document_type = relationship("DocumentType", back_populates="work_order_document_types")
    
    def __repr__(self):
        return f"<WorkOrderDocumentType(work_order_id={self.work_order_id}, document_type_id={self.document_type_id})>"


class WorkOrderTrade(Base):
    """Association between work orders and trades"""
    __tablename__ = "work_order_trades"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Association
    work_order_id = Column(UUID(as_uuid=True), ForeignKey("work_orders.id"), nullable=False)
    trade_id = Column(UUID(as_uuid=True), ForeignKey("trades.id"), nullable=False)
    
    # Trade-specific details for this work order
    estimated_hours = Column(DECIMAL(8, 2))
    hourly_rate = Column(DECIMAL(8, 2))
    markup_percent = Column(DECIMAL(5, 2))
    
    # Status
    is_primary = Column(Boolean, default=False)  # Primary trade for this work order
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    trade = relationship("Trade", back_populates="work_order_trades")
    
    def __repr__(self):
        return f"<WorkOrderTrade(work_order_id={self.work_order_id}, trade_id={self.trade_id})>"