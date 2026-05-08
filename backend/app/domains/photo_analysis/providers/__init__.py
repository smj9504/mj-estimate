"""
Photo Analysis Providers

Different AI provider implementations for photo analysis.
Imports are lazy to avoid loading heavy dependencies (openai, httpx, PIL etc.) at startup.
"""


def __getattr__(name):
    if name == "PhotoAnalysisProvider":
        from app.domains.photo_analysis.providers.base import PhotoAnalysisProvider
        return PhotoAnalysisProvider
    elif name == "OpenAIVisionProvider":
        from app.domains.photo_analysis.providers.openai_vision import OpenAIVisionProvider
        return OpenAIVisionProvider
    elif name == "GeminiVisionProvider":
        from app.domains.photo_analysis.providers.gemini_vision import GeminiVisionProvider
        return GeminiVisionProvider
    elif name == "MockPhotoAnalysisProvider":
        from app.domains.photo_analysis.providers.mock import MockPhotoAnalysisProvider
        return MockPhotoAnalysisProvider
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "PhotoAnalysisProvider",
    "OpenAIVisionProvider",
    "GeminiVisionProvider",
    "MockPhotoAnalysisProvider",
]
