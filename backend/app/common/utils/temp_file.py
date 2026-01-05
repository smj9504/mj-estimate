"""
Temporary File Handler Utility

Provides context managers for safe temporary file management with automatic cleanup.
Works consistently across development (Windows/Mac) and production (Linux/Docker) environments.
"""

import logging
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Generator, Optional, Union

logger = logging.getLogger(__name__)


class TempFileError(Exception):
    """Exception raised for temporary file operation errors"""
    pass


@contextmanager
def temp_file_handler(
    suffix: str = ".tmp",
    prefix: str = "mjapp_",
    dir: Optional[Union[str, Path]] = None,
    delete_on_success: bool = True,
    delete_on_error: bool = True
) -> Generator[Path, None, None]:
    """
    Context manager for safe temporary file handling with automatic cleanup.

    Creates a temporary file that is automatically deleted when the context exits,
    regardless of whether an exception occurred (configurable behavior).

    Args:
        suffix: File extension (e.g., ".pdf", ".tmp")
        prefix: Filename prefix for identification
        dir: Directory for temp file. None uses system default temp directory
        delete_on_success: Whether to delete the file on successful completion
        delete_on_error: Whether to delete the file when an exception occurs

    Yields:
        Path: Path object pointing to the temporary file

    Raises:
        TempFileError: If temp file creation or cleanup fails

    Example:
        >>> with temp_file_handler(suffix=".pdf") as temp_path:
        ...     # Write to temp_path
        ...     pdf_service.generate_pdf(data, str(temp_path))
        ...     # Read and return content
        ...     with open(temp_path, "rb") as f:
        ...         content = f.read()
        ...     # File is automatically deleted after context exits

    Cross-platform compatibility:
        - Windows: Uses %TEMP% directory (usually C:\\Users\\<user>\\AppData\\Local\\Temp)
        - Linux/Docker: Uses /tmp directory
        - Custom dir parameter can override for specific use cases
    """
    temp_path: Optional[Path] = None
    exception_occurred = False

    try:
        # Create temporary file with delete=False so we control deletion
        fd, temp_file_path = tempfile.mkstemp(
            suffix=suffix,
            prefix=prefix,
            dir=str(dir) if dir else None
        )
        # Close the file descriptor immediately - we just need the path
        os.close(fd)
        temp_path = Path(temp_file_path)

        logger.debug(f"Created temporary file: {temp_path}")
        yield temp_path

    except Exception as e:
        exception_occurred = True
        logger.error(f"Error during temp file operation: {e}")
        raise

    finally:
        # Cleanup logic
        if temp_path and temp_path.exists():
            should_delete = (
                (not exception_occurred and delete_on_success) or
                (exception_occurred and delete_on_error)
            )

            if should_delete:
                try:
                    os.unlink(temp_path)
                    logger.debug(f"Cleaned up temporary file: {temp_path}")
                except OSError as cleanup_error:
                    # Log warning but don't raise - cleanup failure shouldn't break the flow
                    logger.warning(
                        f"Failed to clean up temporary file {temp_path}: {cleanup_error}"
                    )


@contextmanager
def temp_directory_handler(
    prefix: str = "mjapp_",
    dir: Optional[Union[str, Path]] = None,
    delete_on_success: bool = True,
    delete_on_error: bool = True
) -> Generator[Path, None, None]:
    """
    Context manager for safe temporary directory handling with automatic cleanup.

    Creates a temporary directory that is automatically deleted (recursively)
    when the context exits.

    Args:
        prefix: Directory name prefix for identification
        dir: Parent directory. None uses system default temp directory
        delete_on_success: Whether to delete the directory on successful completion
        delete_on_error: Whether to delete the directory when an exception occurs

    Yields:
        Path: Path object pointing to the temporary directory

    Example:
        >>> with temp_directory_handler(prefix="batch_") as temp_dir:
        ...     # Create multiple files in temp_dir
        ...     for i, data in enumerate(items):
        ...         file_path = temp_dir / f"file_{i}.pdf"
        ...         generate_pdf(data, file_path)
        ...     # Process all files
        ...     # Directory and all contents are automatically deleted
    """
    import shutil

    temp_dir: Optional[Path] = None
    exception_occurred = False

    try:
        temp_dir_path = tempfile.mkdtemp(
            prefix=prefix,
            dir=str(dir) if dir else None
        )
        temp_dir = Path(temp_dir_path)

        logger.debug(f"Created temporary directory: {temp_dir}")
        yield temp_dir

    except Exception as e:
        exception_occurred = True
        logger.error(f"Error during temp directory operation: {e}")
        raise

    finally:
        if temp_dir and temp_dir.exists():
            should_delete = (
                (not exception_occurred and delete_on_success) or
                (exception_occurred and delete_on_error)
            )

            if should_delete:
                try:
                    shutil.rmtree(temp_dir)
                    logger.debug(f"Cleaned up temporary directory: {temp_dir}")
                except OSError as cleanup_error:
                    logger.warning(
                        f"Failed to clean up temporary directory {temp_dir}: {cleanup_error}"
                    )


def cleanup_temp_file(file_path: Union[str, Path]) -> bool:
    """
    Safely clean up a single temporary file.

    Utility function for cases where manual cleanup is needed outside
    of the context manager pattern.

    Args:
        file_path: Path to the file to delete

    Returns:
        bool: True if file was deleted or didn't exist, False if deletion failed

    Example:
        >>> success = cleanup_temp_file("/tmp/mjapp_abc123.pdf")
        >>> if not success:
        ...     logger.warning("Manual cleanup required")
    """
    path = Path(file_path) if isinstance(file_path, str) else file_path

    if not path.exists():
        return True

    try:
        os.unlink(path)
        logger.debug(f"Cleaned up file: {path}")
        return True
    except OSError as e:
        logger.warning(f"Failed to clean up file {path}: {e}")
        return False


def get_temp_dir() -> Path:
    """
    Get the system temporary directory as a Path object.

    Cross-platform compatible:
        - Windows: Returns %TEMP% (e.g., C:\\Users\\<user>\\AppData\\Local\\Temp)
        - Linux/Docker: Returns /tmp

    Returns:
        Path: System temporary directory
    """
    return Path(tempfile.gettempdir())
