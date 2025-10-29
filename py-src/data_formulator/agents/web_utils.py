# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import requests
from bs4 import BeautifulSoup
from typing import Optional, Union
import logging
from urllib.parse import urlparse
import tempfile
import os

logger = logging.getLogger(__name__)


def download_html_content(url: str, timeout: int = 30, headers: Optional[dict] = None) -> str:
    """
    Download HTML content from a given URL.
    
    Args:
        url (str): The URL to download HTML from
        timeout (int): Request timeout in seconds (default: 30)
        headers (dict, optional): Custom headers for the request
        
    Returns:
        str: The HTML content as a string
        
    Raises:
        requests.RequestException: If the request fails
        ValueError: If the URL is invalid
    """
    if not url:
        raise ValueError("URL cannot be empty")
    
    # Validate URL format
    parsed_url = urlparse(url)
    if not parsed_url.scheme or not parsed_url.netloc:
        raise ValueError(f"Invalid URL format: {url}")
    
    # Set default headers if none provided
    if headers is None:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        }
    
    try:
        response = requests.get(url, timeout=timeout, headers=headers)
        response.raise_for_status()
        
        # Ensure we're getting HTML content
        content_type = response.headers.get('content-type', '').lower()
        if 'text/html' not in content_type and 'application/xhtml' not in content_type:
            logger.warning(f"Content-Type is {content_type}, but proceeding anyway")
        
        return response.text
        
    except requests.RequestException as e:
        logger.error(f"Failed to download HTML from {url}: {str(e)}")
        raise


def html_to_text(html_content: str, remove_scripts: bool = True, remove_styles: bool = True) -> str:
    """
    Convert HTML content to readable text by extracting and cleaning the text content.
    
    Args:
        html_content (str): HTML content as a string
        remove_scripts (bool): Whether to remove script tags (default: True)
        remove_styles (bool): Whether to remove style tags (default: True)
        
    Returns:
        str: Clean, readable text content
    """
    if not html_content or not html_content.strip():
        return ""
    
    try:
        # Parse HTML with BeautifulSoup
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Remove script and style elements if requested
        if remove_scripts:
            for script in soup(["script", "noscript"]):
                script.decompose()
        
        if remove_styles:
            for style in soup(["style"]):
                style.decompose()
        
        # Get text content
        text = soup.get_text()
        
        # Clean up the text
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = ' '.join(chunk for chunk in chunks if chunk)
        
        return text
        
    except Exception as e:
        logger.error(f"Failed to convert HTML to text: {str(e)}")
        # Fallback: return the raw content if parsing fails
        return html_content

def get_html_title(html_content: str) -> Optional[str]:
    """
    Extract the title from HTML content.
    
    Args:
        html_content (str): HTML content as a string
        
    Returns:
        str or None: The title if found, None otherwise
    """
    if not html_content:
        return None
    
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        title_tag = soup.find('title')
        return title_tag.get_text().strip() if title_tag else None
    except Exception as e:
        logger.error(f"Failed to extract title from HTML: {str(e)}")
        return None


def get_html_meta_description(html_content: str) -> Optional[str]:
    """
    Extract the meta description from HTML content.
    
    Args:
        html_content (str): HTML content as a string
        
    Returns:
        str or None: The meta description if found, None otherwise
    """
    if not html_content:
        return None
    
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        meta_desc = soup.find('meta', attrs={'name': 'description'})
        if meta_desc:
            return meta_desc.get('content', '').strip()
        
        # Try Open Graph description
        meta_og_desc = soup.find('meta', attrs={'property': 'og:description'})
        if meta_og_desc:
            return meta_og_desc.get('content', '').strip()
        
        return None
    except Exception as e:
        logger.error(f"Failed to extract meta description from HTML: {str(e)}")
        return None
