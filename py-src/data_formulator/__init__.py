# Import public API functions only - no Flask app import
from data_formulator.api import (
    create_chart_from_fields,
    transform_data_with_nl,
    generate_chart_from_nl,
)

from data_formulator.agents.client_utils import (
    Client,
    OpenAIClientAdapter,
)

def run_app():
    """Launch the Data Formulator Flask application."""
    # Import app only when actually running to avoid side effects
    from data_formulator.app import run_app as _run_app
    return _run_app()

__all__ = [
    "run_app",
    
    # Chart creation
    "create_chart_from_fields",
    "generate_chart_from_nl", 

    # Data transformation
    "transform_data_with_nl",

    # Client
    "Client",
    "OpenAIClientAdapter",
]