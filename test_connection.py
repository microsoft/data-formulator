#!/usr/bin/env python
"""Test script to check model availability and proxy connection"""
import requests
import json
import os
from dotenv import load_dotenv

# Load env vars
load_dotenv("api-keys.env")

print("=" * 60)
print("Environment Variables Check")
print("=" * 60)

openai_enabled = os.getenv("OPENAI_ENABLED", "false")
openai_api_key = os.getenv("OPENAI_API_KEY", "")
openai_api_base = os.getenv("OPENAI_API_BASE", "")
openai_models = os.getenv("OPENAI_MODELS", "")

print(f"OPENAI_ENABLED: {openai_enabled}")
print(f"OPENAI_API_KEY: {openai_api_key[:10]}..." if openai_api_key else "OPENAI_API_KEY: (not set)")
print(f"OPENAI_API_BASE: {openai_api_base}")
print(f"OPENAI_MODELS: {openai_models}")

print("\n" + "=" * 60)
print("Testing LiteLLM Proxy Connection")
print("=" * 60)

if openai_api_base:
    try:
        # Test proxy health
        proxy_url = openai_api_base.rstrip('/v1')
        response = requests.get(f"{proxy_url}/health", timeout=5)
        print(f"✓ Proxy is running at {openai_api_base}")
    except Exception as e:
        print(f"✗ Cannot connect to proxy at {openai_api_base}")
        print(f"  Error: {e}")

print("\n" + "=" * 60)
print("Testing Backend Endpoints")
print("=" * 60)

# Test check-available-models endpoint
try:
    response = requests.get("http://localhost:8000/api/agent/check-available-models", timeout=5)
    if response.status_code == 200:
        models = response.json()
        print(f"✓ Available models found: {len(models)}")
        if models:
            for model in models:
                print(f"  - {model.get('endpoint')}/{model.get('model')}")
        else:
            print("  ⚠ No models found! Check your env file and proxy connection.")
    else:
        print(f"✗ Status code: {response.status_code}")
        print(f"  Response: {response.text}")
except Exception as e:
    print(f"✗ Cannot connect to backend at http://localhost:5000")
    print(f"  Error: {e}")
    print("  Make sure backend is running!")

print("\n" + "=" * 60)
print("Testing Direct Proxy Request")
print("=" * 60)

if openai_api_base:
    try:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer sk-proxy"
        }
        payload = {
            "model": "gpt-4o",
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Say 'I can hear you.'"}
            ]
        }
        response = requests.post(
            f"{openai_api_base}/chat/completions",
            json=payload,
            headers=headers,
            timeout=10
        )
        if response.status_code == 200:
            result = response.json()
            print(f"✓ Proxy request successful!")
            print(f"  Response: {result.get('choices', [{}])[0].get('message', {}).get('content', 'No content')}")
        else:
            print(f"✗ Proxy returned status: {response.status_code}")
            print(f"  Response: {response.text}")
    except Exception as e:
        print(f"✗ Direct proxy request failed")
        print(f"  Error: {e}")

print("\n" + "=" * 60)
print("Summary")
print("=" * 60)
print("If all checks pass (✓), your setup is working correctly!")
print("If any check fails (✗):")
print("  1. Make sure LiteLLM Proxy is running")
print("  2. Make sure backend is running")
print("  3. Check that api-keys.env has correct values")
