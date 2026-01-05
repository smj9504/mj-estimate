"""
Security utilities for preventing common vulnerabilities
"""

import logging
from pathlib import Path
from typing import Union

logger = logging.getLogger(__name__)


class PathTraversalError(ValueError):
    """Exception raised when path traversal attack is detected"""
    pass


def validate_file_path(
    file_path: Union[str, Path],
    allowed_dir: Union[str, Path],
    check_exists: bool = False
) -> Path:
    """
    Validate that a file path is within an allowed directory to prevent path traversal attacks.

    This function protects against directory traversal attacks where malicious input
    like "../../../etc/passwd" could access files outside the intended directory.

    Args:
        file_path: The file path to validate (can be relative or absolute)
        allowed_dir: The directory that the file must be within
        check_exists: If True, also verify the file exists

    Returns:
        The resolved absolute Path if valid

    Raises:
        PathTraversalError: If the path would escape the allowed directory
        FileNotFoundError: If check_exists is True and file doesn't exist

    Example:
        >>> from app.core.config import settings
        >>> validate_file_path("uploads/file.pdf", settings.UPLOAD_DIR)
        Path('/app/uploads/file.pdf')

        >>> validate_file_path("../../../etc/passwd", settings.UPLOAD_DIR)
        PathTraversalError: Path traversal detected: ...
    """
    # Convert to Path objects
    file_path = Path(file_path)
    allowed_dir = Path(allowed_dir)

    # Resolve to absolute paths to handle ".." and "." components
    try:
        resolved_path = file_path.resolve()
        allowed_path = allowed_dir.resolve()
    except (OSError, ValueError) as e:
        logger.warning(f"Security: Invalid path resolution attempt: {file_path} - {e}")
        raise PathTraversalError(f"Invalid file path: {file_path}")

    # Check if the resolved path is within the allowed directory
    try:
        resolved_path.relative_to(allowed_path)
    except ValueError:
        # Path is not relative to allowed_path, meaning it's outside
        logger.warning(
            f"Security: Path traversal attack detected! "
            f"Attempted path: {file_path} resolved to {resolved_path}, "
            f"allowed directory: {allowed_path}"
        )
        raise PathTraversalError(
            f"Invalid file path - path traversal detected: {file_path}"
        )

    # Optionally check if file exists
    if check_exists and not resolved_path.exists():
        raise FileNotFoundError(f"File not found: {resolved_path}")

    return resolved_path


def validate_filename(filename: str) -> str:
    """
    Validate and sanitize a filename to prevent directory traversal via filename.

    This function removes any path separators and dangerous characters from filenames.

    Args:
        filename: The filename to validate

    Returns:
        The sanitized filename

    Raises:
        ValueError: If the filename is empty or invalid after sanitization
    """
    if not filename:
        raise ValueError("Filename cannot be empty")

    # Get just the base filename, removing any directory components
    sanitized = Path(filename).name

    # Remove any remaining dangerous characters
    # Keep only alphanumeric, dots, dashes, underscores, and spaces
    import re
    sanitized = re.sub(r'[^\w\s.\-]', '_', sanitized)

    # Prevent hidden files (starting with .)
    if sanitized.startswith('.'):
        sanitized = '_' + sanitized[1:]

    if not sanitized or sanitized in ('.', '..'):
        raise ValueError(f"Invalid filename: {filename}")

    return sanitized
