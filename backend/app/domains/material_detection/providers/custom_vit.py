"""
Custom Vision Transformer (ViT) Material Detection Provider

Uses Hugging Face Transformers with pre-trained ViT models for construction material detection.
Supports fine-tuning on custom datasets for improved accuracy.
"""

from .base import MaterialDetectionProvider
from app.core.config import settings
import logging
import time
from typing import Dict, Any, Optional, List
from pathlib import Path
import asyncio

logger = logging.getLogger(__name__)


class CustomViTProvider(MaterialDetectionProvider):
    """
    Custom ViT provider using Hugging Face Transformers.

    Features:
    - Pre-trained ViT models from Hugging Face
    - Support for fine-tuned construction material models
    - Batch processing capability
    - GPU acceleration support
    """

    def __init__(self):
        """Initialize Custom ViT provider with model."""
        try:
            from transformers import ViTImageProcessor, ViTForImageClassification
            from PIL import Image
            import torch

            self.Image = Image
            self.torch = torch

            # Model configuration
            self.model_name = getattr(settings, 'CUSTOM_VIT_MODEL_NAME', 'google/vit-base-patch16-224')
            self.custom_model_path = getattr(settings, 'CUSTOM_VIT_MODEL_PATH', None)

            # Load model and processor
            if self.custom_model_path and Path(self.custom_model_path).exists():
                # Load fine-tuned custom model
                logger.info(f"Loading custom ViT model from: {self.custom_model_path}")
                self.processor = ViTImageProcessor.from_pretrained(self.custom_model_path)
                self.model = ViTForImageClassification.from_pretrained(self.custom_model_path)
                self.use_custom_labels = True
            else:
                # Load pre-trained model from Hugging Face
                logger.info(f"Loading pre-trained ViT model: {self.model_name}")
                self.processor = ViTImageProcessor.from_pretrained(self.model_name)
                self.model = ViTForImageClassification.from_pretrained(self.model_name)
                self.use_custom_labels = False

            # Set device (GPU if available)
            self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            self.model.to(self.device)
            self.model.eval()

            # Construction material label mapping (for pre-trained models)
            self.material_mapping = self._load_material_mapping()

            logger.info(f"Custom ViT initialized on device: {self.device}")
            logger.info(f"Using custom labels: {self.use_custom_labels}")

        except ImportError as e:
            logger.error(f"Required packages not installed: {e}")
            raise ValueError(
                "transformers, torch, and pillow packages required. "
                "Install with: pip install transformers torch pillow"
            )
        except Exception as e:
            logger.error(f"Failed to initialize Custom ViT provider: {e}")
            raise

    def _load_material_mapping(self) -> Dict[str, tuple]:
        """
        Load construction material label mapping.

        Maps ImageNet labels to construction material categories.
        For fine-tuned models, this mapping is loaded from model config.

        Returns:
            Dictionary mapping ImageNet labels to (category, type) tuples
        """
        if self.use_custom_labels:
            # Custom model has its own labels
            # Load from model config or separate JSON file
            custom_mapping_path = Path(self.custom_model_path) / "label_mapping.json"
            if custom_mapping_path.exists():
                import json
                with open(custom_mapping_path, 'r') as f:
                    return json.load(f)

            # Default custom labels (construction materials)
            return {
                "hardwood_flooring": ("Hardwood Flooring", "Oak"),
                "tile": ("Tile Flooring", "Ceramic"),
                "carpet": ("Carpet", "Plush"),
                "vinyl": ("Vinyl Flooring", "LVP"),
                "laminate": ("Laminate Flooring", "Wood-look"),
                "concrete": ("Concrete", "Polished"),
                "drywall": ("Drywall", "Standard"),
                "brick": ("Brick", "Red Clay"),
                "stone": ("Stone", "Natural"),
                "metal": ("Metal", "Steel"),
                "wood": ("Wood", "Pine"),
                "glass": ("Glass", "Clear")
            }
        else:
            # ImageNet label mapping to construction materials
            # These are approximate mappings from ImageNet-1K classes
            return {
                # Flooring materials
                "hardwood": ("Hardwood Flooring", "Natural Wood"),
                "parquet": ("Hardwood Flooring", "Parquet"),
                "tile roof": ("Tile Flooring", None),
                "tile": ("Tile Flooring", None),
                "carpet": ("Carpet", None),
                "rug": ("Carpet", "Area Rug"),

                # Wall materials
                "brick": ("Brick", None),
                "stone wall": ("Stone", "Wall Stone"),
                "stucco": ("Stucco", None),

                # Structural materials
                "steel arch bridge": ("Metal", "Steel"),
                "iron": ("Metal", "Iron"),
                "concrete": ("Concrete", None),

                # Other materials
                "wood": ("Wood", None),
                "lumber": ("Wood", "Lumber"),
                "glass": ("Glass", None),
                "plastic": ("Plastic", None)
            }

    async def detect(
        self,
        image_path: str,
        confidence_threshold: float = 0.7,
        options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Detect materials using Custom ViT model.

        Args:
            image_path: Path to image file or URL
            confidence_threshold: Minimum confidence score (0.0-1.0)
            options: Additional options (top_k, batch_size)

        Returns:
            Detection results with materials list
        """
        if not self.validate_image_path(image_path):
            raise ValueError(f"Invalid image path: {image_path}")

        if not self.validate_confidence_threshold(confidence_threshold):
            raise ValueError(f"Invalid confidence threshold: {confidence_threshold}")

        start_time = time.time()
        options = options or {}
        top_k = options.get('top_k', 5)

        try:
            # Load and preprocess image
            image = await self._load_image(image_path)

            # Run inference
            materials = await self._inference(image, confidence_threshold, top_k)

            processing_time = int((time.time() - start_time) * 1000)

            return {
                "materials": materials,
                "processing_time_ms": processing_time,
                "raw_response": {
                    "model_name": self.model_name,
                    "device": str(self.device),
                    "top_k": top_k
                }
            }

        except Exception as e:
            logger.error(f"Custom ViT detection failed: {e}", exc_info=True)
            raise

    async def _load_image(self, image_path: str):
        """
        Load image from path or URL.

        Args:
            image_path: Local path, HTTP(S) URL, or GCS URL

        Returns:
            PIL Image object
        """
        if image_path.startswith('gs://'):
            # Download from GCS
            from google.cloud import storage
            from google.oauth2 import service_account
            import tempfile
            import os

            # Parse GCS URL
            url_parts = image_path.replace('gs://', '').split('/', 1)
            bucket_name = url_parts[0]
            blob_path = url_parts[1] if len(url_parts) > 1 else ''

            # Initialize GCS client
            service_account_file = settings.GCS_SERVICE_ACCOUNT_FILE
            if service_account_file and os.path.exists(service_account_file):
                credentials = service_account.Credentials.from_service_account_file(
                    service_account_file
                )
                storage_client = storage.Client(credentials=credentials)
            else:
                storage_client = storage.Client()

            bucket = storage_client.bucket(bucket_name)
            blob = bucket.blob(blob_path)

            # Download to temporary file
            temp_fd, temp_path = tempfile.mkstemp(suffix=Path(blob_path).suffix)
            os.close(temp_fd)
            blob.download_to_filename(temp_path)

            image = self.Image.open(temp_path).convert('RGB')
            os.unlink(temp_path)  # Cleanup

        elif image_path.startswith(('http://', 'https://')):
            # Download from URL
            import httpx
            import io

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(image_path)
                response.raise_for_status()
                image = self.Image.open(io.BytesIO(response.content)).convert('RGB')
        else:
            # Local file
            image = self.Image.open(image_path).convert('RGB')

        return image

    async def _inference(
        self,
        image,
        confidence_threshold: float,
        top_k: int
    ) -> List[Dict[str, Any]]:
        """
        Run ViT inference on image.

        Args:
            image: PIL Image object
            confidence_threshold: Minimum confidence score
            top_k: Number of top predictions to consider

        Returns:
            List of detected materials
        """
        # Preprocess image
        inputs = self.processor(images=image, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        # Run inference in thread pool (blocking operation)
        loop = asyncio.get_event_loop()
        outputs = await loop.run_in_executor(
            None,
            lambda: self.model(**inputs)
        )

        # Get predictions
        logits = outputs.logits
        probabilities = self.torch.nn.functional.softmax(logits, dim=-1)[0]

        # Get top-k predictions
        top_k_probs, top_k_indices = self.torch.topk(probabilities, k=top_k)

        # Convert to materials
        materials = []
        for prob, idx in zip(top_k_probs.tolist(), top_k_indices.tolist()):
            if prob < confidence_threshold:
                continue

            # Get label
            if self.use_custom_labels:
                label = self.model.config.id2label[idx]
            else:
                label = self.model.config.id2label[idx].lower()

            # Map to construction material
            category, material_type = self._map_label_to_material(label)

            if category:
                material = {
                    "category": category,
                    "type": material_type,
                    "grade": None,  # ViT doesn't provide grade
                    "finish": None,  # ViT doesn't provide finish
                    "confidence": prob,
                    "bounding_box": None  # Classification model doesn't provide bbox
                }
                materials.append(material)

        return materials

    def _map_label_to_material(self, label: str) -> tuple:
        """
        Map model label to construction material category.

        Args:
            label: Model prediction label

        Returns:
            Tuple of (category, type)
        """
        label_lower = label.lower()

        # Direct match
        if label_lower in self.material_mapping:
            return self.material_mapping[label_lower]

        # Fuzzy match
        for key, value in self.material_mapping.items():
            if key in label_lower or label_lower in key:
                return value

        # Check if label contains construction-related keywords
        construction_keywords = [
            'floor', 'wall', 'ceiling', 'roof', 'door', 'window',
            'material', 'building', 'structure', 'surface'
        ]

        if any(keyword in label_lower for keyword in construction_keywords):
            return label.title(), None

        return None, None

    def get_provider_name(self) -> str:
        """Return provider name."""
        return "custom_vit"

    async def health_check(self) -> bool:
        """
        Check if Custom ViT model is loaded and functional.

        Returns:
            True if model is available, False otherwise
        """
        try:
            if not hasattr(self, 'model'):
                return False

            # Verify model is on correct device
            if next(self.model.parameters()).device != self.device:
                return False

            # Optional: Test inference with dummy image
            # dummy_image = self.Image.new('RGB', (224, 224), color='white')
            # inputs = self.processor(images=dummy_image, return_tensors="pt")
            # _ = self.model(**inputs)

            return True

        except Exception as e:
            logger.error(f"Custom ViT health check failed: {e}")
            return False

    def get_capabilities(self) -> Dict[str, Any]:
        """Get Custom ViT provider capabilities."""
        return {
            "max_image_size_mb": 20,
            "max_batch_size": 8 if str(self.device) == 'cuda' else 1,
            "supports_bounding_boxes": False,  # Classification model
            "supports_fine_grained_classification": self.use_custom_labels,
            "rate_limit_per_minute": None,  # No rate limit (local model)
            "model_name": self.model_name,
            "device": str(self.device),
            "gpu_available": self.torch.cuda.is_available(),
            "supported_materials": list(self.material_mapping.keys())
        }

    async def batch_detect(
        self,
        image_paths: List[str],
        confidence_threshold: float = 0.7,
        options: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Batch detection with optimized processing.

        Can process multiple images in parallel if GPU is available.

        Args:
            image_paths: List of image paths
            confidence_threshold: Minimum confidence score
            options: Provider-specific options

        Returns:
            List of detection results
        """
        # For now, use sequential processing
        # TODO: Implement true batch processing with batched inputs
        return await super().batch_detect(image_paths, confidence_threshold, options)
