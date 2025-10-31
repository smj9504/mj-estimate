"""
PyTorch Model Trainer for Construction Material Detection

Multi-attribute classification model using Vision Transformer (ViT) architecture.
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from transformers import ViTForImageClassification, ViTImageProcessor
from PIL import Image
import logging
from typing import Dict, List, Tuple, Optional, Any
from pathlib import Path
import json
from datetime import datetime
from uuid import UUID

logger = logging.getLogger(__name__)


class MaterialDataset(Dataset):
    """Dataset for material detection training"""

    def __init__(
        self,
        images: List[Dict[str, Any]],
        image_processor: ViTImageProcessor,
        augment: bool = False
    ):
        """
        Args:
            images: List of image dicts with labels
            image_processor: ViT image processor
            augment: Whether to apply data augmentation
        """
        self.images = images
        self.image_processor = image_processor
        self.augment = augment

        # Build label encoders
        self.category_to_idx = self._build_label_encoder('material_category')
        self.type_to_idx = self._build_label_encoder('material_type')
        self.grade_to_idx = self._build_label_encoder('material_grade')
        self.finish_to_idx = self._build_label_encoder('material_finish')

    def _build_label_encoder(self, field: str) -> Dict[str, int]:
        """Build label encoder for a field"""
        unique_labels = set()
        for img in self.images:
            label = img.get(field)
            if label:
                unique_labels.add(label)

        # Add 'unknown' for missing labels
        unique_labels.add('unknown')

        return {label: idx for idx, label in enumerate(sorted(unique_labels))}

    def __len__(self) -> int:
        return len(self.images)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, Dict[str, int]]:
        """Get image and labels"""
        img_data = self.images[idx]

        # Load image
        image_path = img_data['image_url']
        if image_path.startswith('gs://'):
            # Handle GCS images - download to temp
            from google.cloud import storage
            client = storage.Client()
            bucket_name = image_path.split('/')[2]
            blob_path = '/'.join(image_path.split('/')[3:])
            bucket = client.bucket(bucket_name)
            blob = bucket.blob(blob_path)

            # Download to temp file
            temp_path = f"/tmp/{Path(blob_path).name}"
            blob.download_to_filename(temp_path)
            image = Image.open(temp_path).convert('RGB')
        else:
            image = Image.open(image_path).convert('RGB')

        # Process image
        inputs = self.image_processor(image, return_tensors='pt')
        pixel_values = inputs['pixel_values'].squeeze(0)

        # Get labels
        labels = {
            'category': self.category_to_idx.get(
                img_data.get('material_category', 'unknown'),
                self.category_to_idx['unknown']
            ),
            'type': self.type_to_idx.get(
                img_data.get('material_type', 'unknown'),
                self.type_to_idx['unknown']
            ),
            'grade': self.grade_to_idx.get(
                img_data.get('material_grade', 'unknown'),
                self.grade_to_idx['unknown']
            ),
            'finish': self.finish_to_idx.get(
                img_data.get('material_finish', 'unknown'),
                self.finish_to_idx['unknown']
            ),
        }

        return pixel_values, labels


class MultiAttributeViT(nn.Module):
    """Multi-attribute classification model using ViT"""

    def __init__(
        self,
        model_name: str,
        num_categories: int,
        num_types: int,
        num_grades: int,
        num_finishes: int
    ):
        """
        Args:
            model_name: Pre-trained ViT model name
            num_categories: Number of material categories
            num_types: Number of material types
            num_grades: Number of material grades
            num_finishes: Number of material finishes
        """
        super().__init__()

        # Load pre-trained ViT
        self.vit = ViTForImageClassification.from_pretrained(
            model_name,
            num_labels=768,  # Use hidden size for feature extraction
            ignore_mismatched_sizes=True
        )

        # Multi-attribute classification heads
        hidden_size = self.vit.config.hidden_size

        self.category_head = nn.Linear(hidden_size, num_categories)
        self.type_head = nn.Linear(hidden_size, num_types)
        self.grade_head = nn.Linear(hidden_size, num_grades)
        self.finish_head = nn.Linear(hidden_size, num_finishes)

    def forward(self, pixel_values: torch.Tensor) -> Dict[str, torch.Tensor]:
        """Forward pass"""
        # Extract features
        outputs = self.vit.vit(pixel_values)
        features = outputs.last_hidden_state[:, 0]  # CLS token

        # Multi-attribute predictions
        return {
            'category': self.category_head(features),
            'type': self.type_head(features),
            'grade': self.grade_head(features),
            'finish': self.finish_head(features),
        }


class MaterialTrainer:
    """Trainer for material detection model"""

    def __init__(
        self,
        model_name: str = "google/vit-base-patch16-224",
        device: Optional[str] = None
    ):
        """
        Args:
            model_name: Pre-trained ViT model name
            device: Device to use ('cuda', 'cpu', or None for auto)
        """
        self.model_name = model_name
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')

        # Image processor
        self.image_processor = ViTImageProcessor.from_pretrained(model_name)

        self.model = None
        self.train_dataset = None
        self.val_dataset = None
        self.test_dataset = None

        logger.info(f"Initialized MaterialTrainer with model={model_name}, device={self.device}")

    def prepare_datasets(
        self,
        train_images: List[Dict[str, Any]],
        val_images: List[Dict[str, Any]],
        test_images: Optional[List[Dict[str, Any]]] = None
    ):
        """Prepare training, validation, and test datasets"""
        self.train_dataset = MaterialDataset(
            train_images,
            self.image_processor,
            augment=True
        )
        self.val_dataset = MaterialDataset(
            val_images,
            self.image_processor,
            augment=False
        )

        if test_images:
            self.test_dataset = MaterialDataset(
                test_images,
                self.image_processor,
                augment=False
            )

        # Initialize model with correct output sizes
        self.model = MultiAttributeViT(
            model_name=self.model_name,
            num_categories=len(self.train_dataset.category_to_idx),
            num_types=len(self.train_dataset.type_to_idx),
            num_grades=len(self.train_dataset.grade_to_idx),
            num_finishes=len(self.train_dataset.finish_to_idx)
        ).to(self.device)

        logger.info(f"Prepared datasets: train={len(train_images)}, val={len(val_images)}, test={len(test_images) if test_images else 0}")

    def train(
        self,
        job_id: UUID,
        epochs: int = 10,
        batch_size: int = 16,
        learning_rate: float = 2e-5,
        weight_decay: float = 0.01,
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Train the model

        Args:
            job_id: Training job ID
            epochs: Number of training epochs
            batch_size: Batch size
            learning_rate: Learning rate
            weight_decay: Weight decay for regularization
            progress_callback: Callback(epoch, metrics)

        Returns:
            Training metrics and history
        """
        if not self.model or not self.train_dataset:
            raise ValueError("Model and datasets must be prepared first")

        # DataLoaders
        train_loader = DataLoader(
            self.train_dataset,
            batch_size=batch_size,
            shuffle=True,
            num_workers=0  # Windows compatibility
        )
        val_loader = DataLoader(
            self.val_dataset,
            batch_size=batch_size,
            shuffle=False,
            num_workers=0
        )

        # Optimizer and loss functions
        optimizer = optim.AdamW(
            self.model.parameters(),
            lr=learning_rate,
            weight_decay=weight_decay
        )
        criterion = nn.CrossEntropyLoss()

        # Training history
        history = {
            'train_loss': [],
            'val_loss': [],
            'val_accuracy': {
                'category': [],
                'type': [],
                'grade': [],
                'finish': []
            }
        }

        best_val_loss = float('inf')
        start_time = datetime.now()

        logger.info(f"Starting training for job {job_id}: {epochs} epochs, batch_size={batch_size}, lr={learning_rate}")

        for epoch in range(epochs):
            # Training phase
            self.model.train()
            train_loss = 0.0

            for batch_idx, (images, labels) in enumerate(train_loader):
                images = images.to(self.device)

                # Forward pass
                optimizer.zero_grad()
                outputs = self.model(images)

                # Calculate loss for each attribute
                loss = 0
                for attr in ['category', 'type', 'grade', 'finish']:
                    target = labels[attr].to(self.device)
                    loss += criterion(outputs[attr], target)

                # Backward pass
                loss.backward()
                optimizer.step()

                train_loss += loss.item()

            train_loss /= len(train_loader)

            # Validation phase
            val_metrics = self._validate(val_loader, criterion)

            # Update history
            history['train_loss'].append(train_loss)
            history['val_loss'].append(val_metrics['loss'])
            for attr in ['category', 'type', 'grade', 'finish']:
                history['val_accuracy'][attr].append(val_metrics['accuracy'][attr])

            # Save best model
            if val_metrics['loss'] < best_val_loss:
                best_val_loss = val_metrics['loss']
                self._save_checkpoint(job_id, epoch, val_metrics)

            # Progress callback
            if progress_callback:
                progress_callback(epoch + 1, {
                    'train_loss': train_loss,
                    **val_metrics
                })

            logger.info(
                f"Epoch {epoch+1}/{epochs} - "
                f"train_loss={train_loss:.4f}, "
                f"val_loss={val_metrics['loss']:.4f}, "
                f"val_acc_category={val_metrics['accuracy']['category']:.4f}"
            )

        # Training complete
        training_time = (datetime.now() - start_time).total_seconds()

        # Final evaluation on test set
        test_metrics = None
        if self.test_dataset:
            test_loader = DataLoader(
                self.test_dataset,
                batch_size=batch_size,
                shuffle=False,
                num_workers=0
            )
            test_metrics = self._validate(test_loader, criterion)

        logger.info(f"Training completed for job {job_id} in {training_time:.2f}s")

        return {
            'job_id': str(job_id),
            'epochs_completed': epochs,
            'training_time_seconds': training_time,
            'best_val_loss': best_val_loss,
            'final_metrics': val_metrics,
            'test_metrics': test_metrics,
            'history': history
        }

    def _validate(
        self,
        dataloader: DataLoader,
        criterion: nn.Module
    ) -> Dict[str, Any]:
        """Validate model on a dataset"""
        self.model.eval()
        val_loss = 0.0
        correct = {'category': 0, 'type': 0, 'grade': 0, 'finish': 0}
        total = 0

        with torch.no_grad():
            for images, labels in dataloader:
                images = images.to(self.device)
                outputs = self.model(images)

                # Calculate loss
                loss = 0
                for attr in ['category', 'type', 'grade', 'finish']:
                    target = labels[attr].to(self.device)
                    loss += criterion(outputs[attr], target)

                    # Calculate accuracy
                    _, predicted = torch.max(outputs[attr], 1)
                    correct[attr] += (predicted == target).sum().item()

                val_loss += loss.item()
                total += images.size(0)

        val_loss /= len(dataloader)
        accuracy = {attr: correct[attr] / total for attr in correct}

        return {
            'loss': val_loss,
            'accuracy': accuracy
        }

    def _save_checkpoint(
        self,
        job_id: UUID,
        epoch: int,
        metrics: Dict[str, Any]
    ):
        """Save model checkpoint"""
        checkpoint_dir = Path(f"./models/training_jobs/{job_id}")
        checkpoint_dir.mkdir(parents=True, exist_ok=True)

        checkpoint = {
            'epoch': epoch,
            'model_state_dict': self.model.state_dict(),
            'metrics': metrics,
            'label_encoders': {
                'category': self.train_dataset.category_to_idx,
                'type': self.train_dataset.type_to_idx,
                'grade': self.train_dataset.grade_to_idx,
                'finish': self.train_dataset.finish_to_idx,
            }
        }

        checkpoint_path = checkpoint_dir / f"checkpoint_epoch_{epoch}.pt"
        torch.save(checkpoint, checkpoint_path)

        # Save best model separately
        best_path = checkpoint_dir / "best_model.pt"
        torch.save(checkpoint, best_path)

        logger.info(f"Saved checkpoint to {checkpoint_path}")

    def load_checkpoint(self, checkpoint_path: str):
        """Load model from checkpoint"""
        checkpoint = torch.load(checkpoint_path, map_location=self.device)

        # Restore label encoders
        label_encoders = checkpoint['label_encoders']

        # Initialize model
        self.model = MultiAttributeViT(
            model_name=self.model_name,
            num_categories=len(label_encoders['category']),
            num_types=len(label_encoders['type']),
            num_grades=len(label_encoders['grade']),
            num_finishes=len(label_encoders['finish'])
        ).to(self.device)

        # Load weights
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.model.eval()

        logger.info(f"Loaded checkpoint from {checkpoint_path}")

        return checkpoint['metrics']
