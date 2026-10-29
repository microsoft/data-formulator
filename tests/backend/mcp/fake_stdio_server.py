"""A tiny MCP server over stdio for tests: arithmetic, long text, an image, and a tool that fails."""
import base64
import sys

from mcp.server import MCPServer
from mcp.types import ImageContent, ToolAnnotations

app = MCPServer("fake", instructions="Fake server notes.")


@app.tool(annotations=ToolAnnotations(read_only_hint=True))
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b


@app.tool()
def big(n: int = 10000) -> str:
    """Return a long text."""
    return "x" * n


@app.tool()
def picture() -> ImageContent:
    """Return a tiny PNG."""
    return ImageContent(type="image", data=base64.b64encode(b"\x89PNG fake").decode(), mime_type="image/png")


@app.tool()
def fail() -> str:
    """Always fails."""
    raise ValueError("deliberate failure")


if __name__ == "__main__":
    app.run("stdio")
