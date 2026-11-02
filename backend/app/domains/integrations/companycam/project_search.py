"""
Find a property's CompanyCam project by how closely its name or address matches
the property's address.
"""

import logging
from difflib import SequenceMatcher
from typing import Any, Dict, Optional

from .client import CompanyCamClient

logger = logging.getLogger(__name__)


async def search_projects_by_address(
    street: str,
    city: str = '',
    state: str = '',
    zipcode: str = '',
    query: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Search CompanyCam projects for a property, best match first.

    Args:
        street, city, state, zipcode: The property's address
        query: Optional search text (uses the street address if not provided)

    Returns:
        The address searched for, the search text and the matching projects
        with their match scores

    Raises:
        ValueError: No query given and no street address to search by
    """
    # Build full address for display
    address_parts = [p for p in [street, city, state, zipcode] if p]
    full_address = ', '.join(address_parts)

    logger.info(f"Address fields: street='{street}', city='{city}', state='{state}', zip='{zipcode}'")

    # Use provided query or extract just the street name for search
    if query:
        search_query = query
    elif street:
        # Extract just the street portion (before any comma)
        # e.g., "4215 Middlebrook Street, Fairfax 22032" -> "4215 Middlebrook Street"
        search_query = street.split(',')[0].strip()
    else:
        search_query = ''

    if not search_query:
        raise ValueError("No search query provided and no address to search by")

    logger.info(f"Searching CompanyCam projects with query: '{search_query}'")

    # Search CompanyCam projects
    client = CompanyCamClient()

    # Try search first
    results = await client.search_projects(search_query, per_page=50)

    # Log raw CompanyCam response for debugging
    logger.info(f"CompanyCam search API response type: {type(results)}")
    if isinstance(results, dict):
        logger.info(f"CompanyCam response keys: {list(results.keys())}")
    logger.info(f"CompanyCam search raw response (first 2000 chars): {str(results)[:2000]}")

    # If search returns empty, fetch all projects and filter locally
    project_list = results if isinstance(results, list) else results.get('data', results.get('projects', []))

    if not project_list:
        logger.info("Search returned empty results. Fetching all projects to filter locally...")

        # Fetch multiple pages of projects
        all_projects = []
        for page_num in range(1, 6):  # Fetch up to 5 pages (500 projects)
            page_results = await client.list_projects(page=page_num, per_page=100)
            page_list = page_results if isinstance(page_results, list) else page_results.get('data', page_results.get('projects', []))

            if not page_list:
                break

            all_projects.extend(page_list)
            logger.info(f"Fetched page {page_num}: {len(page_list)} projects (total: {len(all_projects)})")

            # Stop if we got fewer than requested (last page)
            if len(page_list) < 100:
                break

        # Use all fetched projects
        results = all_projects
        logger.info(f"Total projects fetched for local filtering: {len(results)}")

    # Process and score results
    projects = []
    street_lower = street.lower().strip()
    full_address_lower = full_address.lower().strip()

    # Handle both list and dict response formats
    project_list = results if isinstance(results, list) else results.get('data', results.get('projects', []))

    logger.info(f"Found {len(project_list)} projects from CompanyCam")

    for project in project_list:
        project_id = project.get('id')
        project_name = project.get('name') or ''  # Handle None explicitly

        # Log each project for debugging
        logger.info(f"CompanyCam project: id={project_id}, name='{project_name}', keys={list(project.keys())}")

        # Get project address - CompanyCam may have it in different formats
        project_address = ''
        if 'address' in project:
            addr = project['address']
            logger.info(f"  Project address field: type={type(addr)}, value={addr}")
            if isinstance(addr, str):
                project_address = addr
            elif isinstance(addr, dict):
                # Build address string from components
                parts = [
                    addr.get('street_address_1', ''),
                    addr.get('street_address_2', ''),
                    addr.get('city', ''),
                    addr.get('state', ''),
                    addr.get('postal_code', '')
                ]
                project_address = ', '.join(p for p in parts if p)

        # Calculate match score using SequenceMatcher
        # Compare project name with street (since project name is often the street address)
        project_name_lower = project_name.lower().strip()
        project_address_lower = project_address.lower().strip()

        # Multiple comparisons to find best match
        # 1. Project name vs street address (most common match)
        name_vs_street_score = SequenceMatcher(None, street_lower, project_name_lower).ratio()
        # 2. Project address vs full address
        addr_vs_addr_score = SequenceMatcher(None, full_address_lower, project_address_lower).ratio() if project_address else 0
        # 3. Project name vs full address
        name_vs_addr_score = SequenceMatcher(None, full_address_lower, project_name_lower).ratio()

        # Use best match score
        match_score = max(name_vs_street_score, addr_vs_addr_score, name_vs_addr_score)

        logger.info(f"  Match scores: name_vs_street={name_vs_street_score:.2f}, addr_vs_addr={addr_vs_addr_score:.2f}, name_vs_addr={name_vs_addr_score:.2f} -> best={match_score:.2f}")

        projects.append({
            'id': str(project_id),
            'name': project_name,
            'address': project_address,
            'match_score': round(match_score * 100, 1),  # Convert to percentage
            'photo_count': project.get('photo_count', 0),
            'created_at': project.get('created_at'),
            'updated_at': project.get('updated_at')
        })

    # Sort by match score descending
    projects.sort(key=lambda x: x['match_score'], reverse=True)

    # Filter to only show projects with at least some match (>10%)
    # but include all if we did a local search (from list_projects)
    min_score = 10 if project_list else 0
    filtered_projects = [p for p in projects if p['match_score'] >= min_score]

    # Take top 20 results
    top_projects = filtered_projects[:20]

    logger.info(
        f"Returning {len(top_projects)} projects "
        f"(filtered from {len(projects)} total, min_score={min_score}%)"
    )

    return {
        'job_address': full_address,
        'search_query': search_query,
        'projects': top_projects,
        'total': len(top_projects)
    }
