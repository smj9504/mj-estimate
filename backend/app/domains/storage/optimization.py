"""
Storage optimization utilities
Applicable to all cloud storage providers (GCS, S3, Azure, etc.)
"""

import io
import hashlib
import gzip
import logging
from typing import BinaryIO, Optional, Tuple, Dict, Any
from pathlib import Path
from PIL import Image

logger = logging.getLogger(__name__)


class ImageOptimizer:
    """
    Image optimization utilities
    - WebP conversion
    - Resizing
    - Quality optimization
    - EXIF handling
    """

    @staticmethod
    def optimize(
        file_data: BinaryIO,
        max_size: Tuple[int, int] = (1920, 1920),
        quality: int = 85,
        format: str = 'WebP',
        preserve_exif: bool = False
    ) -> Tuple[io.BytesIO, Dict[str, Any]]:
        """
        Optimize image for storage

        Args:
            file_data: Image file data
            max_size: Maximum dimensions (width, height)
            quality: Compression quality (1-100)
            format: Output format (WebP, JPEG, PNG)
            preserve_exif: Keep EXIF data

        Returns:
            Tuple of (optimized_file, metadata)
        """
        try:
            # Open image
            img = Image.open(file_data)
            original_format = img.format
            original_size = file_data.tell() if hasattr(file_data, 'tell') else 0

            # Get original dimensions
            original_width, original_height = img.size

            # Handle EXIF orientation
            if hasattr(img, '_getexif') and img._getexif():
                try:
                    exif = img._getexif()
                    orientation = exif.get(274)  # Orientation tag

                    if orientation == 3:
                        img = img.rotate(180, expand=True)
                    elif orientation == 6:
                        img = img.rotate(270, expand=True)
                    elif orientation == 8:
                        img = img.rotate(90, expand=True)
                except Exception as e:
                    logger.warning(f"EXIF orientation handling failed: {e}")

            # Convert RGBA to RGB if necessary
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background

            # Resize if necessary
            if img.size[0] > max_size[0] or img.size[1] > max_size[1]:
                img.thumbnail(max_size, Image.Resampling.LANCZOS)
                logger.info(f"Resized image from {original_width}x{original_height} to {img.size[0]}x{img.size[1]}")

            # Save optimized image
            output = io.BytesIO()
            save_kwargs = {
                'format': format,
                'quality': quality,
                'optimize': True
            }

            # Format-specific options
            if format == 'WebP':
                save_kwargs['method'] = 6  # Best compression
            elif format == 'JPEG':
                save_kwargs['progressive'] = True

            # Preserve EXIF if requested
            if preserve_exif and hasattr(img, 'info') and 'exif' in img.info:
                save_kwargs['exif'] = img.info['exif']

            img.save(output, **save_kwargs)
            output.seek(0)

            # Calculate compression ratio
            optimized_size = len(output.getvalue())
            compression_ratio = (1 - optimized_size / original_size) * 100 if original_size > 0 else 0

            metadata = {
                'original_format': original_format,
                'optimized_format': format,
                'original_size': original_size,
                'optimized_size': optimized_size,
                'compression_ratio': f"{compression_ratio:.1f}%",
                'original_dimensions': f"{original_width}x{original_height}",
                'final_dimensions': f"{img.size[0]}x{img.size[1]}"
            }

            logger.debug(f"Image optimized: {compression_ratio:.1f}% reduction ({original_size} → {optimized_size} bytes)")

            return output, metadata

        except Exception as e:
            logger.error(f"Image optimization failed: {e}")
            # Return original file on error
            file_data.seek(0)
            return file_data, {'error': str(e), 'optimized': False}


class FileDeduplicator:
    """
    File deduplication using content hashing
    Prevents storing duplicate files
    """

    @staticmethod
    def calculate_hash(file_data: BinaryIO, algorithm: str = 'sha256') -> str:
        """
        Calculate file hash

        Args:
            file_data: File data
            algorithm: Hash algorithm (sha256, md5, sha1)

        Returns:
            Hex digest of file hash
        """
        file_data.seek(0)

        if algorithm == 'sha256':
            hasher = hashlib.sha256()
        elif algorithm == 'md5':
            hasher = hashlib.md5()
        elif algorithm == 'sha1':
            hasher = hashlib.sha1()
        else:
            raise ValueError(f"Unsupported hash algorithm: {algorithm}")

        # Read in chunks for large files
        chunk_size = 8192
        while chunk := file_data.read(chunk_size):
            hasher.update(chunk)

        file_data.seek(0)
        return hasher.hexdigest()

    @staticmethod
    def generate_dedup_key(file_hash: str, content_type: Optional[str] = None) -> str:
        """
        Generate deduplication key

        Args:
            file_hash: File content hash
            content_type: MIME type (optional)

        Returns:
            Deduplication key
        """
        parts = ['dedup', file_hash]
        if content_type:
            # Simplify content type (e.g., image/jpeg -> jpeg)
            simplified = content_type.split('/')[-1].lower()
            parts.append(simplified)

        return '/'.join(parts)


class FileCompressor:
    """
    File compression utilities
    For text files, JSON, CSV, logs, etc.
    """

    @staticmethod
    def compress_gzip(file_data: BinaryIO) -> Tuple[bytes, Dict[str, Any]]:
        """
        Compress file using gzip

        Args:
            file_data: File data

        Returns:
            Tuple of (compressed_data, metadata)
        """
        file_data.seek(0)
        original_data = file_data.read()
        original_size = len(original_data)

        compressed_data = gzip.compress(original_data, compresslevel=9)
        compressed_size = len(compressed_data)

        compression_ratio = (1 - compressed_size / original_size) * 100 if original_size > 0 else 0

        metadata = {
            'encoding': 'gzip',
            'original_size': original_size,
            'compressed_size': compressed_size,
            'compression_ratio': f"{compression_ratio:.1f}%"
        }

        logger.info(f"File compressed: {compression_ratio:.1f}% reduction ({original_size} → {compressed_size} bytes)")

        return compressed_data, metadata

    @staticmethod
    def should_compress(content_type: Optional[str], size_threshold: int = 1024) -> bool:
        """
        Determine if file should be compressed

        Args:
            content_type: MIME type
            size_threshold: Minimum size to compress (bytes)

        Returns:
            True if should compress
        """
        if not content_type:
            return False

        # Compressible types
        compressible = [
            'text/',
            'application/json',
            'application/xml',
            'application/javascript',
            'application/csv',
            'application/sql'
        ]

        # Already compressed types (skip)
        already_compressed = [
            'image/',  # JPEG, PNG, WebP already compressed
            'video/',
            'audio/',
            'application/zip',
            'application/gzip',
            'application/x-7z-compressed',
            'application/x-rar-compressed'
        ]

        # Check if already compressed
        for prefix in already_compressed:
            if content_type.startswith(prefix):
                return False

        # Check if compressible
        for prefix in compressible:
            if content_type.startswith(prefix):
                return True

        return False


class StorageOptimizer:
    """
    Main storage optimization coordinator
    Combines all optimization strategies
    """

    def __init__(
        self,
        enable_image_optimization: bool = True,
        enable_deduplication: bool = True,
        enable_compression: bool = True,
        image_quality: int = 85,
        image_format: str = 'WebP'
    ):
        """
        Initialize storage optimizer

        Args:
            enable_image_optimization: Enable image optimization
            enable_deduplication: Enable file deduplication
            enable_compression: Enable text file compression
            image_quality: Image compression quality (1-100)
            image_format: Image output format (WebP, JPEG, PNG)
        """
        self.enable_image_optimization = enable_image_optimization
        self.enable_deduplication = enable_deduplication
        self.enable_compression = enable_compression
        self.image_quality = image_quality
        self.image_format = image_format

        self.image_optimizer = ImageOptimizer()
        self.deduplicator = FileDeduplicator()
        self.compressor = FileCompressor()

    def optimize_file(
        self,
        file_data: BinaryIO,
        filename: str,
        content_type: Optional[str] = None
    ) -> Tuple[BinaryIO, Dict[str, Any]]:
        """
        Optimize file based on type

        Args:
            file_data: File data
            filename: Original filename
            content_type: MIME type

        Returns:
            Tuple of (optimized_file, optimization_metadata)
        """
        metadata = {
            'original_filename': filename,
            'optimizations_applied': []
        }

        # Image optimization
        if self.enable_image_optimization and content_type and content_type.startswith('image/'):
            try:
                optimized_file, img_meta = self.image_optimizer.optimize(
                    file_data,
                    quality=self.image_quality,
                    format=self.image_format
                )
                metadata['image_optimization'] = img_meta
                metadata['optimizations_applied'].append('image_optimization')
                file_data = optimized_file
            except Exception as e:
                logger.warning(f"Image optimization skipped: {e}")

        # Text file compression
        if self.enable_compression and self.compressor.should_compress(content_type):
            try:
                compressed_data, comp_meta = self.compressor.compress_gzip(file_data)
                metadata['compression'] = comp_meta
                metadata['optimizations_applied'].append('gzip_compression')

                # Convert to BytesIO
                file_data = io.BytesIO(compressed_data)
            except Exception as e:
                logger.warning(f"Compression skipped: {e}")

        # Calculate hash for deduplication
        if self.enable_deduplication:
            try:
                file_hash = self.deduplicator.calculate_hash(file_data)
                metadata['file_hash'] = file_hash
                metadata['dedup_key'] = self.deduplicator.generate_dedup_key(file_hash, content_type)
                metadata['optimizations_applied'].append('deduplication_hash')
            except Exception as e:
                logger.warning(f"Hash calculation skipped: {e}")

        file_data.seek(0)
        return file_data, metadata
