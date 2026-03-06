# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Prompt Guard Agent

Middleware agent that validates user prompts using LLM before passing to main agents.
- Detects spam / off-topic prompts early using semantic LLM analysis
- Saves tokens by rejecting invalid requests before expensive processing
- Uses LLM to perform intelligent semantic analysis (not just regex patterns)
- Runs ONCE per prompt, lightweight
"""

import json
import logging
import re
from typing import Dict, List

from data_formulator.agents.qc_chart_config import is_qc_data

logger = logging.getLogger(__name__)


def extract_all_columns_from_input_tables(input_tables) -> List[str]:
    """
    Extract all unique column names from input_tables.
    
    input_tables format: list of dicts with 'name' and 'rows' keys
    rows format: list of dicts (JSON records)
    
    Args:
        input_tables: List of tables with 'rows' key containing JSON records
        
    Returns:
        List of all unique column names from all tables
    """
    if not input_tables:
        return []
    
    all_columns = set()
    for table in input_tables:
        if isinstance(table, dict) and 'rows' in table and table['rows']:
            # Get columns from first row (all rows should have same columns)
            first_row = table['rows'][0]
            if isinstance(first_row, dict):
                all_columns.update(first_row.keys())
    
    return sorted(list(all_columns))


class PromptGuardAgent:
    """
    Lightweight guard agent that validates chart prompts semantically using LLM.
    
    Returns validation result with:
    - ok: bool (is prompt valid for chart visualization?)
    - reason: str (explanation in English for internal logging)
    - user_message: str (in same language as input, friendly and contextual)
    - detected_language: str (detected language code: en, vi, etc.)
    
    Accepts user prompts in any language (English, Vietnamese, etc.)
    Returns output in the same language as input, defaults to English if unrecognized.
    This guard prevents wasting tokens on spam/off-topic prompts.
    
    QC Data Definition: Uses standard QC data detection (from qc_chart_config)
    - Must have TARGET column
    - Must have at least one of: LL, UL, ARLL, ARUL
    """
    
    def __init__(self, client=None, model="gpt-4o-mini"):
        """
        Args:
            client: OpenAI/Azure client (if None, will attempt to create from env)
            model: LLM model to use for analysis (default: lightweight model)
        """
        self.client = client
        self.model = model
        
        # QC-specific chart types that require QC data characteristics
        self.qc_chart_patterns = [
            r'\bqc\s+(trend\s+)?bar',
            r'\bqc\s+(trend\s+)?line',
            r'\bqc\s+histogram',
            r'\bqc\s+box\s*(-)?plot',
            r'\bqc\s+pareto',
            r'\bqc\s+control\s+chart',
            r'\bqc\s+cpk',
            r'\bqc\s+scatter',
            r'\bqc\s+dispersion',
            r'\bqc\s+capability',
            r'biểu\s+đồ\s+qc',  # Vietnamese
            r'qc\s+biểu\s+đồ',   # Vietnamese
        ]
        
        # Lazy import to avoid circular dependency
        if self.client is None:
            try:
                from openai import AzureOpenAI
                self.client = AzureOpenAI()
            except Exception as e:
                logger.warning(f"Failed to initialize OpenAI client: {e}")
    
    def _is_qc_chart_request(self, prompt: str) -> bool:
        """Detect if user is requesting a QC-specific chart type."""
        text_lower = prompt.lower()
        for pattern in self.qc_chart_patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                return True
        return False
    
    def _is_qc_data(self, data_columns: List[str]) -> bool:
        """
        Check if provided data appears to be QC data based on column names.
        Uses the standard QC data definition from qc_chart_config:
        - Must have TARGET column
        - Must have at least one of: LL, UL, ARLL, ARUL
        """
        if not data_columns:
            return False
        
        # Use the standard QC data detection from qc_chart_config
        return is_qc_data(data_columns)
    
    def _detect_language_quick(self, text: str) -> str:
        """Quick language detection based on text patterns (fallback when LLM unavailable)."""
        text_lower = text.lower()
        
        # Vietnamese indicators
        if any(word in text_lower for word in ['vẽ', 'biểu', 'đồ', 'bạn', 'tạo', 'của', 'với']):
            return 'vi'
        # French indicators
        if any(word in text_lower for word in ['créer', 'graphique', 'diagramme', 'montrer', 'données']):
            return 'fr'
        # Spanish indicators
        if any(word in text_lower for word in ['crear', 'gráfico', 'diagrama', 'mostrar', 'datos']):
            return 'es'
        # Default to English
        return 'en'
    
    def _get_qc_mismatch_message(self, language: str) -> str:
        """Get QC data mismatch warning message in specific language."""
        messages = {
            'en': "⚠️ You selected a QC chart type (like QC Trend Bar, QC Histogram). "
                  "These chart types are designed for QC data with columns like TARGET, LL, UL, ARUL. "
                  "Your data doesn't appear to have these QC characteristics. "
                  "Please choose a different chart type or select data with QC control limits (TARGET + LL/UL/ARUL).",
            'vi': "⚠️ Bạn đã chọn loại biểu đồ QC (như QC Trend Bar, QC Histogram). "
                  "Các loại biểu đồ này được thiết kế cho dữ liệu QC với các cột như TARGET, LL, UL, ARUL. "
                  "Dữ liệu của bạn không có các đặc trưng QC (TARGET + giới hạn kiểm soát). "
                  "Vui lòng chọn loại biểu đồ khác hoặc sử dụng dữ liệu có TARGET và các cột giới hạn (LL/UL/ARUL).",
            'fr': "⚠️ Vous avez sélectionné un type de graphique QC (comme QC Trend Bar, QC Histogram). "
                  "Ces types de graphiques sont conçus pour les données QC avec des colonnes comme TARGET, LL, UL, ARUL. "
                  "Vos données n'ont pas les caractéristiques QC requises (TARGET + limites de contrôle). "
                  "Veuillez choisir un type de graphique différent ou utiliser des données avec TARGET et des colonnes limites (LL/UL/ARUL).",
            'es': "⚠️ Ha seleccionado un tipo de gráfico QC (como QC Trend Bar, QC Histogram). "
                  "Estos tipos de gráficos están diseñados para datos QC con columnas como TARGET, LL, UL, ARUL. "
                  "Sus datos no parecen tener las características QC (TARGET + límites de control). "
                  "Por favor, elija un tipo de gráfico diferente o use datos con TARGET y columnas de límites (LL/UL/ARUL).",
        }
        return messages.get(language, messages['en'])
    
    def validate(self, prompt: str, data_columns: List[str] = None) -> Dict:
        """
        Validate if prompt is suitable for chart visualization.
        
        Also validates QC-specific chart requests against actual data characteristics.
        
        Accepts prompts in any language (English, Vietnamese, etc.)
        Returns output in the same language as the input. If language cannot be detected, defaults to English.
        
        Uses LLM to:
        1. Detect language of input prompt
        2. Validate if prompt is spam/gibberish/repetitive
        3. Check if prompt relates to charting/visualization
        4. Assess if it's actionable (has enough context)
        5. If QC chart type requested, verify data has QC characteristics
        
        Args:
            prompt: User's chart request prompt (any language)
            data_columns: Optional list of column names in user's data. 
                         Used to validate QC-specific chart requests.
                         QC data must have: TARGET (required) + at least one of [LL, UL, ARUL, ARLL]
                         Example: ['VALUE', 'TARGET', 'LL', 'UL', 'QCSTDPARAMNAME']
            
        Returns:
            {
                "ok": bool,
                "reason_code": str,           # 'valid', 'spam', 'not_chart_related', 'too_vague', 'empty', 'too_short', 'qc_data_mismatch', 'guard_error'
                "reason": str,                # Internal log reason (always in English)
                "detected_language": str,     # Language code detected: 'en', 'vi', 'fr', 'es', etc.
                "is_qc_chart_request": bool,  # True if user requested QC-specific chart type
                "is_qc_data": bool,           # True if data appears to be QC data (has TARGET + LL/UL/ARUL/ARLL)
                "user_message": str           # Friendly message for user (in detected language, or English default)
            }
        """
        text = (prompt or "").strip()
        
        # Quick pre-check: completely empty
        if not text:
            return {
                "ok": False,
                "reason_code": "empty",
                "reason": "Empty prompt",
                "detected_language": "en",  # Default to English
                "user_message": "Please enter a chart request. Example: 'Draw a line chart', 'bar chart sales by month'",
                "is_qc_chart_request": False,
                "is_qc_data": False,
            }
        
        # Quick pre-check: extremely short (likely filtered out anyway)
        if len(text) < 2:
            return {
                "ok": False,
                "reason_code": "too_short",
                "reason": "Prompt too short",
                "detected_language": "en",  # Default to English
                "user_message": "Your request is too short. Please be more specific (e.g., 'Draw a bar chart')",
                "is_qc_chart_request": False,
                "is_qc_data": False,
            }
        
        # QC-specific validation: Check if QC chart type is requested with non-QC data
        is_qc_chart_request = self._is_qc_chart_request(text)
        is_qc_data = self._is_qc_data(data_columns) if data_columns is not None else None
        
        logger.debug(f"Guard: QC chart request={is_qc_chart_request}, QC data={is_qc_data}")
        
        # If QC chart requested but data provided and it's NOT QC data, warn user
        if is_qc_chart_request and data_columns is not None and not is_qc_data:
            # Determine language for warning
            detected_language = self._detect_language_quick(text)
            return {
                "ok": False,
                "reason_code": "qc_data_mismatch",
                "reason": "QC chart type requested but data is not QC data (missing VALUE, LL, UL, etc.)",
                "detected_language": detected_language,
                "is_qc_chart_request": True,
                "is_qc_data": False,
                "user_message": self._get_qc_mismatch_message(detected_language),
            }
        
        # Call LLM for semantic analysis
        try:
            if not self.client:
                logger.warning("Guard: No client available, cannot validate prompt")
                # Reject on missing client (safer than pass-through)
                return {
                    "ok": False,
                    "reason_code": "guard_error",
                    "reason": "Guard agent has no client to validate",
                    "detected_language": "en",  # Default to English
                    "user_message": "System error: cannot validate request. Please try again.",
                    "is_qc_chart_request": is_qc_chart_request,
                    "is_qc_data": is_qc_data if is_qc_data is not None else False,
                }
            
            logger.debug(f"Guard: Calling LLM for prompt: '{text}'")
            response = self.client.get_completion(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a specialized prompt analysis assistant that works with multiple languages. "
                            "Your task: evaluate if a user prompt is suitable for creating charts/data visualizations. "
                            "Analyze natural language - don't just do keyword matching. User may write in English, Vietnamese, or other languages.\n\n"
                            "STEP 1: DETECT INPUT LANGUAGE\n"
                            "- Analyze the user's prompt to identify their language\n"
                            "- Common codes: 'en' (English), 'vi' (Vietnamese), 'fr' (French), 'es' (Spanish), 'de' (German), 'zh' (Chinese), 'ja' (Japanese), etc.\n"
                            "- If language cannot be clearly identified, default to 'en' (English)\n\n"
                            "STEP 2: VALIDATE CHART REQUEST\n"
                            "ACCEPT prompts related to:\n"
                            "- Chart types: bar, line, pie, scatter, area, histogram, heatmap, funnel, tree, sankey, network, bubble, waterfall, radar, etc.\n"
                            "- Data visualization from tables/databases\n"
                            "- Data analysis & reporting\n"
                            "Valid examples: 'draw bar chart', 'line chart sales by month', 'compare data', 'analyze trends', 'vẽ bubble plot', 'biểu đồ heat map'\n\n"
                            "REJECT ONLY if:\n"
                            "1. Spam/gibberish: repeated characters (e.g., 'aaa', '123123'), meaningless (e.g., 'alo 1234', 'xyz')\n"
                            "2. Off-topic: NOT related to visualization/data/charts (e.g., 'how to cook?', 'calculate derivative', 'teach me programming')\n"
                            "3. Too vague - NO chart type: just 'draw chart' or 'show data' or 'draw something' WITHOUT specific chart type\n"
                            "   → BUT 'draw line chart' or 'vẽ bar chart' IS VALID (has specific chart type)\n\n"
                            "Criteria:\n"
                            "- Has chart type keyword → VALID (e.g., 'draw line chart', 'vẽ biểu đồ line chart', 'pie chart', 'scatter plot')\n"
                            "- Only 'draw chart' or 'show data' WITHOUT chart type → too_vague\n"
                            "- Repeated chars or meaningless → spam\n"
                            "- Not related to charts/data → not_chart_related\n\n"
                            "STEP 3: OUTPUT JSON\n"
                            "Return ONLY valid JSON, no other text:\n"
                            "{\n"
                            "  \"detected_language\": \"en|vi|fr|es|de|zh|ja|...\",\n"
                            "  \"ok\": true/false,\n"
                            "  \"reason_code\": \"valid|spam|not_chart_related|too_vague\",\n"
                            "  \"reason\": \"Short explanation in English (for logging)\",\n"
                            "  \"user_message\": \"Friendly, contextual message in the SAME LANGUAGE as the user's input\"\n"
                            "}\n\n"
                            "IMPORTANT ABOUT user_message:\n"
                            "- MUST BE IN THE SAME LANGUAGE AS THE USER'S INPUT\n"
                            "- If detected_language is 'vi' (Vietnamese), respond in Vietnamese\n"
                            "- If detected_language is 'en' (English), respond in English\n"
                            "- If detected_language is 'fr' (French), respond in French\n"
                            "- If VALID: simple acknowledgment like 'Ready. Processing...' (in user's language)\n"
                            "- If REJECT: be friendly, specific, helpful:\n"
                            "  * Suggest how to fix the prompt (in user's language)\n"
                            "  * Include specific examples (in user's language)\n"
                            "  * Explain WHY it was rejected (in user's language)\n"
                            "  * Tone: helpful, not cold - use emoji if appropriate"
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Analyze this prompt:\n{text}",
                    }
                ]
            )
            
            # Parse response - get_completion returns OpenAI-compatible format
            logger.debug(f"Guard: LLM response type: {type(response)}, response: {response}")
            try:
                # OpenAI format: response.choices[0].message.content
                result_text = response.choices[0].message.content.strip()
            except (AttributeError, IndexError, TypeError) as e:
                logger.error(f"Guard: Failed to extract content from response: {e}")
                logger.error(f"Guard: Response object: {response}, type: {type(response)}")
                # Try fallback methods
                if hasattr(response, 'content'):
                    result_text = response.content.strip()
                else:
                    result_text = str(response).strip()
            logger.debug(f"Guard: Extracted text: '{result_text}'")
            
            # Extract JSON from response (LLM might include extra text)
            json_text = result_text
            if '{' in result_text and '}' in result_text:
                # Try to extract JSON block
                start_idx = result_text.find('{')
                end_idx = result_text.rfind('}') + 1
                if start_idx >= 0 and end_idx > start_idx:
                    json_text = result_text[start_idx:end_idx]
                    logger.debug(f"Guard: Extracted JSON from text: '{json_text}'")
            
            result = json.loads(json_text)
            ok = result.get("ok", False)
            reason_code = result.get("reason_code", "unknown")
            reason = result.get("reason", "Unknown reason")
            detected_language = result.get("detected_language", "en")
            
            # Use user_message from LLM (in user's detected language)
            # Fallback to default if LLM doesn't provide one
            if "user_message" in result and result.get("user_message"):
                user_message = result["user_message"].strip()
            else:
                # Fallback to default messages if LLM didn't generate user_message
                # Messages organized by language
                default_messages = {
                    "en": {
                        "valid": "✓ Ready. Processing your request...",
                        "spam": "❌ That request doesn't make sense. Please enter a clear chart visualization request.",
                        "not_chart_related": "❌ That's not related to chart visualization. What chart would you like to create?",
                        "too_vague": "❌ Please specify which chart type you want: 'draw line chart', 'bar chart', 'pie chart', 'scatter plot', etc.",
                    },
                    "vi": {
                        "valid": "✓ Sẵn sàng. Đang xử lý yêu cầu của bạn...",
                        "spam": "❌ Yêu cầu đó không có ý nghĩa. Vui lòng nhập yêu cầu trực quan hóa biểu đồ rõ ràng.",
                        "not_chart_related": "❌ Đó không liên quan đến biểu đồ. Bạn muốn tạo biểu đồ gì?",
                        "too_vague": "❌ Vui lòng chỉ định loại biểu đồ: 'vẽ biểu đồ line', 'bar chart', 'pie chart', 'scatter plot', v.v.",
                    },
                    "fr": {
                        "valid": "✓ Prêt. Traitement de votre demande...",
                        "spam": "❌ Cette demande n'a pas de sens. Veuillez entrer une demande de visualisation graphique claire.",
                        "not_chart_related": "❌ Ce n'est pas lié à la visualisation graphique. Quel graphique souhaitez-vous créer?",
                        "too_vague": "❌ Veuillez spécifier le type de graphique: 'tracer un graphique linéaire', 'graphique en barres', 'graphique circulaire', etc.",
                    },
                    "es": {
                        "valid": "✓ Listo. Procesando tu solicitud...",
                        "spam": "❌ Esa solicitud no tiene sentido. Por favor, ingrese una solicitud clara de visualización de gráficos.",
                        "not_chart_related": "❌ Eso no está relacionado con la visualización de gráficos. ¿Qué gráfico deseas crear?",
                        "too_vague": "❌ Por favor especifica el tipo de gráfico: 'crear gráfico de líneas', 'gráfico de barras', 'gráfico circular', etc.",
                    },
                }
                
                # Get messages for detected language, fallback to English
                lang_messages = default_messages.get(detected_language, default_messages["en"])
                user_message = lang_messages.get(reason_code, "Error validating request. Please try again.")
            
            logger.info(f"Guard validation: ok={ok}, code={reason_code}, lang={detected_language}, reason={reason}")
            logger.info(f"Guard validation: ok={ok}, code={reason_code}, lang={detected_language}, reason={reason}")
            logger.debug(f"Guard: User message: {user_message}")
            
            return {
                "ok": ok,
                "reason_code": reason_code,
                "reason": reason,
                "detected_language": detected_language,
                "is_qc_chart_request": is_qc_chart_request,
                "is_qc_data": is_qc_data if is_qc_data is not None else False,
                "user_message": user_message,
            }
        
        except json.JSONDecodeError as e:
            logger.error(f"Guard: JSON decode error: {e}")
            logger.error(f"Guard: Could not parse LLM response. Response text was: '{result_text}'")
            # If guard can't parse response, reject (safer) but log the error for debugging
            return {
                "ok": False,
                "reason_code": "guard_error",
                "reason": f"Guard: JSON parse error - response not valid JSON",
                "detected_language": "en",  # Default to English
                "user_message": "Error validating prompt. Please try again.",
                "is_qc_chart_request": is_qc_chart_request,
                "is_qc_data": is_qc_data if is_qc_data is not None else False,
            }
        
        except AttributeError as e:
            logger.error(f"Guard: Response object issue: {e}")
            logger.error(f"Guard: Response type: {type(response)}, response: {response}")
            # Response doesn't have expected attributes
            return {
                "ok": False,
                "reason_code": "guard_error",
                "reason": f"Guard: Unexpected LLM response format - {str(e)}",
                "detected_language": "en",  # Default to English
                "user_message": "Error validating prompt. Please try again.",
                "is_qc_chart_request": is_qc_chart_request,
                "is_qc_data": is_qc_data if is_qc_data is not None else False,
            }
        
        except Exception as e:
            logger.error(f"Guard: Validation error: {type(e).__name__}: {e}")
            logger.error(f"Guard: Full traceback for prompt '{text}': ", exc_info=True)
            # On error, reject (guard should not silently pass through invalid requests)
            return {
                "ok": False,
                "reason_code": "guard_error",
                "reason": f"Guard error: {type(e).__name__}: {str(e)}",
                "detected_language": "en",  # Default to English
                "user_message": "Error validating prompt. Please try again.",
                "is_qc_chart_request": is_qc_chart_request,
                "is_qc_data": is_qc_data if is_qc_data is not None else False,
            }

