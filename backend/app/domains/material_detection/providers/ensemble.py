"""
Ensemble Material Detection Provider

Combines predictions from multiple providers for improved accuracy.
Uses weighted voting and confidence aggregation strategies.
"""

from .base import MaterialDetectionProvider
from .google_vision import GoogleVisionProvider
from .custom_vit import CustomViTProvider
from app.core.config import settings
import logging
import time
import asyncio
from typing import Dict, Any, Optional, List
from collections import defaultdict

logger = logging.getLogger(__name__)


class EnsembleProvider(MaterialDetectionProvider):
    """
    Ensemble provider that combines multiple detection models.

    Strategies:
    - Weighted voting: Combine predictions with configurable weights
    - Confidence aggregation: Average or max confidence scores
    - Consensus filtering: Only include materials detected by multiple models
    """

    def __init__(self, existing_providers: Optional[Dict[str, MaterialDetectionProvider]] = None):
        """
        Initialize Ensemble provider with existing provider instances.

        Args:
            existing_providers: Dictionary of already initialized providers.
                               If None, will create new instances (not recommended).
        """
        self.providers: Dict[str, MaterialDetectionProvider] = {}
        self.provider_weights: Dict[str, float] = {}

        if existing_providers:
            # Use existing provider instances (efficient - no re-initialization)
            self._use_existing_providers(existing_providers)
        else:
            # Fallback: Initialize new providers (inefficient - for backward compatibility)
            logger.warning("EnsembleProvider initialized without existing providers - creating new instances")
            self._initialize_providers()

        if not self.providers:
            raise ValueError("No providers available for ensemble")

        logger.info(f"Ensemble initialized with {len(self.providers)} providers: {list(self.providers.keys())}")

    def _use_existing_providers(self, existing_providers: Dict[str, MaterialDetectionProvider]):
        """
        Use already initialized provider instances.

        Args:
            existing_providers: Dictionary of provider instances from ProviderManager
        """
        # Add Google Vision if available
        if 'google_vision' in existing_providers:
            self.providers['google_vision'] = existing_providers['google_vision']
            self.provider_weights['google_vision'] = 1.0
            logger.info("✓ Google Vision provider added to ensemble (reused)")

        # Add Custom ViT if available
        if 'custom_vit' in existing_providers:
            self.providers['custom_vit'] = existing_providers['custom_vit']
            self.provider_weights['custom_vit'] = 1.5  # Higher weight for custom model
            logger.info("✓ Custom ViT provider added to ensemble (reused)")

        # Add Roboflow if available (disabled by default)
        if 'roboflow' in existing_providers:
            self.providers['roboflow'] = existing_providers['roboflow']
            self.provider_weights['roboflow'] = 1.2
            logger.info("✓ Roboflow provider added to ensemble (reused)")

    def _initialize_providers(self):
        """
        Initialize new provider instances (fallback for backward compatibility).

        NOTE: This creates new provider instances which is inefficient.
        Prefer using existing_providers parameter in __init__.
        """
        # Google Vision provider
        try:
            self.providers['google_vision'] = GoogleVisionProvider()
            self.provider_weights['google_vision'] = 1.0
            logger.info("✓ Google Vision provider added to ensemble")
        except Exception as e:
            logger.warning(f"Failed to initialize Google Vision for ensemble: {e}")

        # Custom ViT provider
        try:
            self.providers['custom_vit'] = CustomViTProvider()
            self.provider_weights['custom_vit'] = 1.5  # Higher weight for custom model
            logger.info("✓ Custom ViT provider added to ensemble")
        except Exception as e:
            logger.warning(f"Failed to initialize Custom ViT for ensemble: {e}")

        # Roboflow provider (disabled by default)
        # if settings.ROBOFLOW_API_KEY:
        #     try:
        #         from .roboflow import RoboflowProvider
        #         self.providers['roboflow'] = RoboflowProvider()
        #         self.provider_weights['roboflow'] = 1.2
        #         logger.info("✓ Roboflow provider added to ensemble")
        #     except Exception as e:
        #         logger.warning(f"Failed to initialize Roboflow for ensemble: {e}")

    async def detect(
        self,
        image_path: str,
        confidence_threshold: float = 0.7,
        options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Detect materials using ensemble of multiple providers.

        Args:
            image_path: Path to image file or URL
            confidence_threshold: Minimum confidence score (0.0-1.0)
            options: Ensemble options
                - strategy: 'voting', 'consensus', 'union' (default: 'voting')
                - min_providers: Minimum providers that must agree (for consensus)
                - aggregation: 'mean', 'max', 'weighted_mean' (default: 'weighted_mean')

        Returns:
            Detection results with aggregated materials
        """
        if not self.validate_image_path(image_path):
            raise ValueError(f"Invalid image path: {image_path}")

        if not self.validate_confidence_threshold(confidence_threshold):
            raise ValueError(f"Invalid confidence threshold: {confidence_threshold}")

        start_time = time.time()
        options = options or {}
        strategy = options.get('strategy', 'voting')
        min_providers = options.get('min_providers', 2)
        aggregation = options.get('aggregation', 'weighted_mean')

        try:
            # Run all providers in parallel
            logger.info(f"Running ensemble detection with {len(self.providers)} providers")

            tasks = []
            provider_names = []

            for name, provider in self.providers.items():
                task = provider.detect(image_path, confidence_threshold, options)
                tasks.append(task)
                provider_names.append(name)

            # Wait for all providers to complete
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Collect successful results
            provider_results = {}
            for name, result in zip(provider_names, results):
                if isinstance(result, Exception):
                    logger.error(f"Provider {name} failed: {result}")
                else:
                    provider_results[name] = result
                    logger.info(f"Provider {name}: {len(result.get('materials', []))} materials detected")

            # Aggregate results based on strategy
            if strategy == 'voting':
                materials = self._voting_strategy(
                    provider_results,
                    confidence_threshold,
                    aggregation
                )
            elif strategy == 'consensus':
                materials = self._consensus_strategy(
                    provider_results,
                    min_providers,
                    aggregation
                )
            elif strategy == 'union':
                materials = self._union_strategy(
                    provider_results,
                    confidence_threshold
                )
            else:
                raise ValueError(f"Unknown strategy: {strategy}")

            processing_time = int((time.time() - start_time) * 1000)

            return {
                "materials": materials,
                "processing_time_ms": processing_time,
                "raw_response": {
                    "strategy": strategy,
                    "providers_used": list(provider_results.keys()),
                    "provider_results": {
                        name: {
                            "materials_count": len(result.get('materials', [])),
                            "processing_time_ms": result.get('processing_time_ms', 0)
                        }
                        for name, result in provider_results.items()
                    }
                }
            }

        except Exception as e:
            logger.error(f"Ensemble detection failed: {e}", exc_info=True)
            raise

    def _voting_strategy(
        self,
        provider_results: Dict[str, Dict[str, Any]],
        confidence_threshold: float,
        aggregation: str
    ) -> List[Dict[str, Any]]:
        """
        Voting strategy: Combine all detections with weighted confidence.

        Args:
            provider_results: Results from each provider
            confidence_threshold: Minimum confidence after aggregation
            aggregation: How to aggregate confidence scores

        Returns:
            List of materials with aggregated confidence
        """
        # Group materials by category
        material_groups = defaultdict(list)

        for provider_name, result in provider_results.items():
            weight = self.provider_weights.get(provider_name, 1.0)

            for material in result.get('materials', []):
                category = material.get('category', '').lower()
                material_type = material.get('type', '')

                # Create unique key for grouping
                key = f"{category}|{material_type}".lower()

                material_groups[key].append({
                    'provider': provider_name,
                    'weight': weight,
                    'material': material
                })

        # Aggregate grouped materials
        aggregated_materials = []

        for key, detections in material_groups.items():
            # Get most common values
            categories = [d['material']['category'] for d in detections]
            types = [d['material'].get('type') for d in detections if d['material'].get('type')]

            # Aggregate confidence
            if aggregation == 'weighted_mean':
                total_weight = sum(d['weight'] for d in detections)
                confidence = sum(
                    d['material']['confidence'] * d['weight']
                    for d in detections
                ) / total_weight
            elif aggregation == 'mean':
                confidence = sum(d['material']['confidence'] for d in detections) / len(detections)
            elif aggregation == 'max':
                confidence = max(d['material']['confidence'] for d in detections)
            else:
                confidence = sum(d['material']['confidence'] for d in detections) / len(detections)

            # Only include if confidence meets threshold
            if confidence < confidence_threshold:
                continue

            # Get bounding box from provider with highest confidence (if available)
            best_detection = max(detections, key=lambda d: d['material']['confidence'])
            bounding_box = best_detection['material'].get('bounding_box')

            aggregated_materials.append({
                'category': max(set(categories), key=categories.count),  # Most common
                'type': max(set(types), key=types.count) if types else None,
                'grade': None,
                'finish': None,
                'confidence': confidence,
                'bounding_box': bounding_box,
                'providers_agreed': len(detections),
                'providers_used': [d['provider'] for d in detections]
            })

        # Sort by confidence
        aggregated_materials.sort(key=lambda x: x['confidence'], reverse=True)

        return aggregated_materials

    def _consensus_strategy(
        self,
        provider_results: Dict[str, Dict[str, Any]],
        min_providers: int,
        aggregation: str
    ) -> List[Dict[str, Any]]:
        """
        Consensus strategy: Only include materials detected by multiple providers.

        Args:
            provider_results: Results from each provider
            min_providers: Minimum number of providers that must agree
            aggregation: How to aggregate confidence scores

        Returns:
            List of materials with consensus
        """
        # Use voting strategy first
        all_materials = self._voting_strategy(provider_results, 0.0, aggregation)

        # Filter by consensus
        consensus_materials = [
            material for material in all_materials
            if material.get('providers_agreed', 0) >= min_providers
        ]

        logger.info(
            f"Consensus strategy: {len(consensus_materials)}/{len(all_materials)} "
            f"materials agreed by {min_providers}+ providers"
        )

        return consensus_materials

    def _union_strategy(
        self,
        provider_results: Dict[str, Dict[str, Any]],
        confidence_threshold: float
    ) -> List[Dict[str, Any]]:
        """
        Union strategy: Include all unique materials from all providers.

        Args:
            provider_results: Results from each provider
            confidence_threshold: Minimum confidence for inclusion

        Returns:
            List of all unique materials
        """
        all_materials = []
        seen_keys = set()

        for provider_name, result in provider_results.items():
            for material in result.get('materials', []):
                if material['confidence'] < confidence_threshold:
                    continue

                # Create unique key
                category = material.get('category', '').lower()
                material_type = material.get('type', '')
                key = f"{category}|{material_type}".lower()

                if key not in seen_keys:
                    seen_keys.add(key)

                    # Add provider info
                    material_copy = material.copy()
                    material_copy['provider'] = provider_name

                    all_materials.append(material_copy)

        # Sort by confidence
        all_materials.sort(key=lambda x: x['confidence'], reverse=True)

        return all_materials

    def get_provider_name(self) -> str:
        """Return provider name."""
        return "ensemble"

    async def health_check(self) -> bool:
        """
        Check if at least one provider in ensemble is healthy.

        Returns:
            True if any provider is available, False otherwise
        """
        try:
            health_checks = await asyncio.gather(
                *[provider.health_check() for provider in self.providers.values()],
                return_exceptions=True
            )

            healthy_count = sum(
                1 for check in health_checks
                if not isinstance(check, Exception) and check
            )

            logger.info(f"Ensemble health check: {healthy_count}/{len(self.providers)} providers healthy")

            return healthy_count > 0

        except Exception as e:
            logger.error(f"Ensemble health check failed: {e}")
            return False

    def get_capabilities(self) -> Dict[str, Any]:
        """Get Ensemble provider capabilities."""
        # Combine capabilities from all providers
        combined_caps = {
            "max_image_size_mb": 20,
            "max_batch_size": 10,
            "supports_bounding_boxes": True,
            "supports_fine_grained_classification": True,
            "rate_limit_per_minute": None,
            "providers": {
                name: provider.get_capabilities()
                for name, provider in self.providers.items()
            },
            "strategies": ["voting", "consensus", "union"],
            "aggregation_methods": ["mean", "max", "weighted_mean"]
        }

        return combined_caps
