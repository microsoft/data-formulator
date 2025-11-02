# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import requests
from bs4 import BeautifulSoup
from typing import Optional, Union
import logging
from urllib.parse import urlparse
import tempfile
import os
import socket
import ipaddress

logger = logging.getLogger(__name__)


def _is_private_ip(ip_str: str) -> bool:
    """
    Check if an IP address is private, internal, or otherwise restricted.
    
    Args:
        ip_str: IP address as a string
        
    Returns:
        bool: True if IP is private/restricted, False if public
    """
    try:
        ip_obj = ipaddress.ip_address(ip_str)
        
        # Check if IP is private, loopback, link-local, multicast, reserved, or unspecified
        if (
            ip_obj.is_private or
            ip_obj.is_loopback or
            ip_obj.is_link_local or
            ip_obj.is_multicast or
            ip_obj.is_reserved or
            ip_obj.is_unspecified
        ):
            return True
        
        # Explicitly block cloud metadata endpoints
        # AWS/Azure/GCP metadata endpoint
        if ip_str == "169.254.169.254":
            return True
            
        # AWS IPv6 metadata endpoint
        if ip_str.startswith("fd00:ec2::"):
            return True
            
        return False
        
    except ValueError:
        # Not a valid IP address
        return False


def _validate_url_for_ssrf(url: str) -> str:
    """
    Validate a URL to prevent SSRF attacks.
    
    Performs the following checks:
    1. Protocol validation (HTTP/HTTPS only)
    2. Private IP blocking
    
    Args:
        url: The URL to validate
        
    Returns:
        str: The validated URL
        
    Raises:
        ValueError: If the URL fails any security checks
    """
    if not url:
        raise ValueError("URL cannot be empty")
    
    # Parse and validate URL format
    parsed_url = urlparse(url)
    if not parsed_url.scheme or not parsed_url.netloc:
        raise ValueError(f"Invalid URL format: {url}")
    
    # Protection 1: Only allow HTTP/HTTPS schemes
    if parsed_url.scheme.lower() not in ("http", "https"):
        raise ValueError(
            f"Blocked: Unsupported URL scheme '{parsed_url.scheme}'. "
            f"Only HTTP and HTTPS are allowed to prevent SSRF attacks."
        )
    
    hostname = parsed_url.hostname
    if not hostname:
        raise ValueError(f"Could not extract hostname from URL: {url}")
    
    # Protection 2: Block requests to private/internal IP addresses
    try:
        # Resolve all addresses for the hostname (handles both IPv4 and IPv6)
        addr_info = socket.getaddrinfo(hostname, None)
        
        for res in addr_info:
            addr = res[4][0]
            
            # Check if this resolved IP is private/internal
            if _is_private_ip(addr):
                raise ValueError(
                    f"Blocked: URL '{url}' resolves to private/internal IP address {addr}. "
                    f"Access to private networks is not allowed to prevent SSRF attacks."
                )
                
    except socket.gaierror as e:
        raise ValueError(f"Could not resolve hostname '{hostname}': {str(e)}") from e
    
    return url


def download_html_content(url: str, timeout: int = 30, headers: Optional[dict] = None) -> str:
    """
    Download HTML content from a given URL with SSRF protection.
    
    This function implements comprehensive SSRF protection:
    1. Protocol validation (HTTP/HTTPS only)
    2. Private IP blocking (before request)
    3. Redirect validation (validates all redirect destinations)
    4. Timeout limits (prevents slowloris attacks)
    5. Logging of all accessed URLs (for security auditing)
    
    Args:
        url (str): The URL to download HTML from
        timeout (int): Request timeout in seconds (default: 30, max: 60)
        headers (dict, optional): Custom headers for the request
        
    Returns:
        str: The HTML content as a string
        
    Raises:
        requests.RequestException: If the request fails
        ValueError: If the URL is invalid or blocked by SSRF protection
    """
    # Protection 5: Log all URL access attempts for security auditing
    logger.info(f"Attempting to download HTML from URL: {url}")
    
    # Protection 1 & 2: Validate URL for SSRF (protocol and IP checks)
    _validate_url_for_ssrf(url)
    
    # Protection 4: Enforce reasonable timeout limits (prevent slowloris)
    if timeout <= 0:
        timeout = 30
    elif timeout > 60:
        logger.warning(f"Timeout of {timeout}s exceeds maximum, capping at 60s")
        timeout = 60
    
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
        # Protection 3: Use a session to handle and validate redirects
        with requests.Session() as session:
            # Create a custom adapter to hook into redirect handling
            class SSRFSafeHTTPAdapter(requests.adapters.HTTPAdapter):
                def send(self, request, **kwargs):
                    # Validate each request (including redirects)
                    try:
                        _validate_url_for_ssrf(request.url)
                    except ValueError as e:
                        # Log the blocked redirect attempt
                        logger.error(f"Blocked redirect to unsafe URL: {request.url} - {str(e)}")
                        raise
                    return super().send(request, **kwargs)
            
            # Mount the adapter for both HTTP and HTTPS
            adapter = SSRFSafeHTTPAdapter()
            session.mount('http://', adapter)
            session.mount('https://', adapter)
            
            # Make the request (redirects will be validated automatically)
            response = session.get(
                url, 
                timeout=timeout, 
                headers=headers,
                allow_redirects=True  # Safe because we validate each redirect
            )
            response.raise_for_status()
            
            # Log successful access and any redirects that occurred
            if response.history:
                redirect_chain = " -> ".join([r.url for r in response.history] + [response.url])
                logger.info(f"Successfully downloaded HTML with redirects: {redirect_chain}")
            else:
                logger.info(f"Successfully downloaded HTML from: {url}")
            
            # Ensure we're getting HTML content
            content_type = response.headers.get('content-type', '').lower()
            if 'text/html' not in content_type and 'application/xhtml' not in content_type:
                logger.warning(f"Content-Type is {content_type}, but proceeding anyway")
            
            return response.text
        
    except ValueError as e:
        # SSRF protection blocked the request
        logger.error(f"SSRF protection blocked request to {url}: {str(e)}")
        raise
    except requests.RequestException as e:
        # Network or HTTP error
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
