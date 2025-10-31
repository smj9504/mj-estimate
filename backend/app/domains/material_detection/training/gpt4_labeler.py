"""
GPT-4 Vision Auto-Labeling Service

Automatically label construction material images using GPT-4 Vision API.
"""

import base64
import os
from typing import Dict, Any, Optional, List
from openai import OpenAI
import json
from pathlib import Path
import logging
from google.cloud import storage
import io

logger = logging.getLogger(__name__)


class GPT4VisionLabeler:
    """
    Auto-label images using GPT-4 Vision API

    Cost: ~$0.01 per image (high resolution mode)
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OpenAI API key not found. Set OPENAI_API_KEY environment variable.")

        # Initialize OpenAI client (v1.0+ API)
        self.client = OpenAI(api_key=self.api_key)

        # Initialize GCS client for loading images
        # Use service account credentials from environment variable
        service_account_file = os.getenv("GCS_SERVICE_ACCOUNT_FILE")
        if service_account_file and Path(service_account_file).exists():
            self.gcs_client = storage.Client.from_service_account_json(service_account_file)
            logger.info(f"GCS client initialized with service account: {service_account_file}")
        else:
            logger.warning("GCS_SERVICE_ACCOUNT_FILE not found, using default credentials")
            self.gcs_client = None

    def encode_image_from_path(self, image_path: str) -> str:
        """Encode local image to base64"""
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')

    def encode_image_from_gcs(self, gcs_url: str) -> str:
        """Download and encode GCS image to base64"""
        if not self.gcs_client:
            raise ValueError("GCS client not initialized. Check GCS_SERVICE_ACCOUNT_FILE environment variable.")

        # Parse GCS URL: gs://bucket-name/path/to/file
        if not gcs_url.startswith("gs://"):
            raise ValueError(f"Invalid GCS URL: {gcs_url}")

        parts = gcs_url[5:].split("/", 1)
        bucket_name = parts[0]
        blob_path = parts[1] if len(parts) > 1 else ""

        bucket = self.gcs_client.bucket(bucket_name)
        blob = bucket.blob(blob_path)

        # Download to memory
        image_bytes = blob.download_as_bytes()
        return base64.b64encode(image_bytes).decode('utf-8')

    def label_image(
        self,
        image_path: str,
        temperature: float = 0.0,
        detail: str = "high"
    ) -> Dict[str, Any]:
        """
        Label a single image using GPT-4 Vision

        Args:
            image_path: Local path or GCS URL (gs://...)
            temperature: Sampling temperature (0 = deterministic)
            detail: Image resolution ('low', 'high')

        Returns:
            {
                "category": str,
                "type": str,
                "species": str,
                "grade": str,
                "width": str,
                "finish": str,
                "color": str,
                "thickness": str,
                "condition": str,
                "confidence": {
                    "category": 0-100,
                    "type": 0-100,
                    ...
                },
                "description": str,
                "raw_response": str
            }
        """
        try:
            # Encode image
            if image_path.startswith("gs://"):
                base64_image = self.encode_image_from_gcs(image_path)
                logger.info(f"Loaded image from GCS: {image_path}")
            else:
                base64_image = self.encode_image_from_path(image_path)
                logger.info(f"Loaded image from local path: {image_path}")

            # Prepare prompt
            prompt = self._get_labeling_prompt()

            # Call GPT-4 Vision API (v1.0+ client)
            # Using gpt-4o which supports vision (gpt-4-vision-preview is deprecated)
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": prompt
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{base64_image}",
                                    "detail": detail
                                }
                            }
                        ]
                    }
                ],
                max_tokens=500,
                temperature=temperature
            )

            # Parse response
            content = response.choices[0].message.content
            logger.debug(f"GPT-4 Vision response: {content}")

            # Extract JSON from response
            labels = self._parse_json_response(content)

            # Add raw response for debugging
            labels["raw_response"] = content

            # Validate confidence scores
            labels = self._validate_labels(labels)

            logger.info(f"Successfully labeled image: {labels.get('category', 'Unknown')} "
                       f"(confidence: {labels.get('confidence', {}).get('category', 0)}%)")

            return labels

        except Exception as e:
            logger.error(f"Failed to label image {image_path}: {e}", exc_info=True)
            return {
                "category": None,
                "error": str(e),
                "raw_response": None
            }

    def batch_label_images(
        self,
        image_paths: List[str],
        batch_size: int = 10,
        progress_callback: Optional[callable] = None
    ) -> List[Dict[str, Any]]:
        """
        Label multiple images in batches

        Args:
            image_paths: List of image paths (local or GCS)
            batch_size: Number of images to process before reporting progress
            progress_callback: Callback function(processed, total, current_result)

        Returns:
            List of label dictionaries
        """
        results = []
        total = len(image_paths)

        for idx, image_path in enumerate(image_paths):
            try:
                labels = self.label_image(image_path)
                results.append({
                    "image_path": image_path,
                    "labels": labels,
                    "status": "success" if not labels.get("error") else "failed"
                })

                # Progress callback
                if progress_callback and (idx + 1) % batch_size == 0:
                    progress_callback(idx + 1, total, results[-1])

            except Exception as e:
                logger.error(f"Batch labeling failed for {image_path}: {e}")
                results.append({
                    "image_path": image_path,
                    "labels": {"error": str(e)},
                    "status": "failed"
                })

        # Final progress callback
        if progress_callback:
            progress_callback(total, total, None)

        logger.info(f"Batch labeling completed: {len(results)} images processed, "
                   f"{sum(1 for r in results if r['status'] == 'success')} successful")

        return results

    def _get_labeling_prompt(self) -> str:
        """Get the labeling prompt for GPT-4 Vision"""
        return """
        You are an expert in construction materials, damage assessment, and material specifications. Analyze this image and identify the PRIMARY building material with detailed specifications that affect pricing.

        Return ONLY a valid JSON object (no markdown, no code blocks):

        {
          "category": "Flooring | Carpet | Tile | Trim | Siding | Roofing | Insulation | Drywall | Paint | Structural | Other",
          "type": "SPECIFIC TYPE - Examples:
                   Flooring: Hardwood Solid | Hardwood Engineered | Laminate | Vinyl Plank | Sheet Vinyl
                   Carpet: Berber | Plush | Frieze | Saxony | Loop Pile | Cut Pile | Cut and Loop
                   Tile: Ceramic | Porcelain | Natural Stone | Luxury Vinyl Tile
                   Trim: Baseboard | Crown Molding | Door Casing | Window Trim | Chair Rail
                   Siding: Vinyl | Wood | Fiber Cement | Metal | Stucco | Brick
                   Roofing: Asphalt Shingle | Metal | Tile | TPO | EPDM
                   Insulation: Fiberglass Batt | Spray Foam | Blown-in | Rigid Foam
                   Drywall: Regular | Moisture Resistant | Fire Rated",
          "species": "Material composition - Oak | Maple | Walnut | Cherry | Pine | Cedar | Nylon | Polyester | Polypropylene | Wool | Triexta",
          "grade": "Quality tier - Economy | Builder Grade | Standard | Premium | Luxury | Commercial Heavy Traffic",
          "width": "Dimension - 2.25in | 3.25in | 5in | 7in | 12ft | 15ft | 12x12 | 18x18 | 12x24 | Plank",
          "finish": "Surface - Matte | Glossy | Semi-Gloss | Satin | Smooth | Textured | Hand-scraped | Distressed | Stain Resistant",
          "color": "Color with pattern - Solid Beige | Multi-tone Gray | Dark Walnut | Natural Oak | Patterned",
          "thickness": "Physical depth - 3/4in | 1/2in | 3/8in | 12mm | 8mm | Pile: Low/Medium/High",
          "density": "CRITICAL FOR CARPET - Visual texture tightness: Low (<2000) | Medium (2000-3000) | High (3000-4000) | Premium (>4000)",
          "pattern": "CRITICAL FOR CARPET - Solid | Berber Loop | Geometric | Striped | Textured | Multi-level Loop | Random",
          "condition": "State - New | Good | Fair | Worn | Damaged | Water Damaged | Mold | Stained",
          "additional_specs": "Other pricing factors - R-Value, Gauge, Profile style, Face weight oz/sqyd, etc.",
          "confidence": {
            "category": 95,
            "type": 85,
            "species": 70,
            "grade": 60,
            "density": 50,
            "pattern": 80
          },
          "description": "Detailed description highlighting cost-affecting characteristics",
          "secondary_materials": "Brief note if other materials visible (e.g., 'Baseboards and door trim also visible')"
        }

        CATEGORY-SPECIFIC CRITICAL SPECS:

        CARPET (CRITICAL - affects $/sqft):
        - Fiber: Nylon (best durability) | Polyester | Polypropylene (budget) | Wool (luxury)
        - Style: Berber (loop, durable) | Plush (soft, shows tracks) | Frieze (twisted, hides marks)
        - Density: Estimate from visual tightness (higher = more durable = more expensive)
        - Pattern: Solid | Loop | Geometric | Multi-level (affects installation cost)
        - Pile Height: Low <0.5in (commercial) | Medium 0.5-0.75in | High >0.75in (plush)

        HARDWOOD FLOORING:
        - Species: Oak (standard) | Maple | Walnut (premium) | Cherry | Exotic
        - Type: Solid 3/4in | Engineered (stable) | Laminate (budget)
        - Width: Narrow 2.25in | Medium 3.25-5in | Wide 7in+ (trending)
        - Grade: Select (uniform) | #1 Common (character) | #2 Common (rustic)
        - Finish: Prefinished | Site-finished | Hand-scraped (premium)

        TILE:
        - Type: Ceramic (budget) | Porcelain (durable) | Natural Stone (premium) | LVT
        - Size: Small 12x12 | Medium 18x18 | Large 12x24+ | Plank | Mosaic
        - Finish: Matte | Polished | Textured | Honed

        TRIM:
        - Type: Baseboard | Crown Molding | Door/Window Casing | Chair Rail
        - Material: MDF (paint-grade) | Pine | Oak | PVC
        - Profile: Colonial | Modern | Craftsman
        - Size: Height x Thickness

        SIDING:
        - Type: Vinyl | Wood (Cedar) | Fiber Cement (Hardie) | Metal | Stucco
        - Profile: Dutch Lap | Beaded | Board and Batten | Shake | Scallop
        - Gauge: 0.040 | 0.044 | 0.046 (thicker = better)

        ROOFING:
        - Type: Asphalt (standard) | Architectural (premium) | Metal | Tile
        - Weight/Warranty: 20yr | 30yr | 50yr lifetime
        - Style: 3-tab | Dimensional | Designer

        INSULATION:
        - Type: Fiberglass Batt | Spray Foam (premium) | Blown-in | Rigid
        - R-Value: R-13 (walls) | R-19 | R-30 (attic) | R-38 | R-49

        Rules:
        - Identify PRIMARY material (largest/most prominent)
        - Be VERY specific - specifications directly affect pricing
        - Use null for truly unknown fields
        - For CARPET: density and pattern are CRITICAL
        - Confidence scores 0-100 (be realistic)
        - Return ONLY valid JSON, no extra text
        """

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        """Extract and parse JSON from GPT-4 response"""
        try:
            # Try direct JSON parse first
            return json.loads(content)
        except json.JSONDecodeError:
            # Extract JSON from markdown code blocks or text
            json_start = content.find('{')
            json_end = content.rfind('}') + 1

            if json_start == -1 or json_end == 0:
                raise ValueError("No JSON object found in response")

            json_str = content[json_start:json_end]
            return json.loads(json_str)

    def _validate_labels(self, labels: Dict[str, Any]) -> Dict[str, Any]:
        """Validate and normalize label data"""
        # Ensure confidence scores are present
        if "confidence" not in labels:
            labels["confidence"] = {}

        # Convert confidence scores to integers (0-100)
        for key in ["category", "type", "species", "grade", "width", "finish", "color", "thickness"]:
            if key in labels["confidence"]:
                try:
                    score = float(labels["confidence"][key])
                    labels["confidence"][key] = max(0, min(100, int(score * 100 if score <= 1.0 else score)))
                except (ValueError, TypeError):
                    labels["confidence"][key] = 0

        return labels

    def estimate_cost(self, num_images: int, detail: str = "high") -> Dict[str, float]:
        """
        Estimate labeling cost

        GPT-4 Vision pricing (as of 2024):
        - Low detail: $0.00765 per image
        - High detail: ~$0.01-0.02 per image (depends on resolution)

        Args:
            num_images: Number of images to label
            detail: 'low' or 'high'

        Returns:
            {
                "total_cost": float,
                "cost_per_image": float,
                "num_images": int
            }
        """
        cost_per_image = 0.01 if detail == "high" else 0.00765
        total_cost = num_images * cost_per_image

        return {
            "total_cost": round(total_cost, 2),
            "cost_per_image": cost_per_image,
            "num_images": num_images,
            "detail": detail
        }
