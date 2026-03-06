# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Unit tests for PromptGuardAgent

Test scenarios:
- Valid chart prompts (should pass)
- Spam/gibberish (should reject)
- Off-topic requests (should reject)
- Vague requests (should reject)
- Language detection and multilingual output (output in same language as input)
"""

import pytest
from unittest.mock import Mock, patch
from data_formulator.agents.prompt_guard_agent import PromptGuardAgent


class TestPromptGuardAgent:
    """Test suite for PromptGuardAgent"""
    
    @pytest.fixture
    def mock_client(self):
        """Create a mock OpenAI client"""
        return Mock()
    
    @pytest.fixture
    def guard(self, mock_client):
        """Create a PromptGuardAgent with mock client"""
        return PromptGuardAgent(client=mock_client, model="gpt-4o-mini")
    
    def test_empty_prompt(self, guard):
        """Test: empty prompt should be rejected with default English message"""
        result = guard.validate("")
        assert result["ok"] is False
        assert result["reason_code"] == "empty"
        assert result["detected_language"] == "en"  # Default to English
        assert "please enter" in result["user_message"].lower() or "chart" in result["user_message"].lower()
    
    def test_very_short_prompt(self, guard):
        """Test: very short prompt should be rejected with default English message"""
        result = guard.validate("a")
        assert result["ok"] is False
        assert result["reason_code"] == "too_short"
        assert result["detected_language"] == "en"  # Default to English
        assert "short" in result["user_message"].lower() or "specific" in result["user_message"].lower()
    
    def test_client_unavailable(self):
        """Test: if client unavailable, reject with guard error message in English"""
        guard = PromptGuardAgent(client=None)
        # No client available, should reject
        result = guard.validate("vẽ biểu đồ")
        assert result["ok"] is False
        assert result["reason_code"] == "guard_error"
        assert result["detected_language"] == "en"  # Default to English when error
        assert result["user_message"] is not None  # Should have error message
    
    def test_valid_chart_prompt_english(self, guard, mock_client):
        """Test: valid English chart prompt - output in English"""
        # Mock LLM response (using LiteLLM format with .content attribute)
        mock_response = Mock()
        mock_response.choices = [
            Mock(message=Mock(content='{"detected_language": "en", "ok": true, "reason_code": "valid", "reason": "Clear chart request", "user_message": "Ready. Processing your request..."}'))
        ]
        mock_client.get_completion.return_value = mock_response
        
        result = guard.validate("Draw a line chart of sales over time")
        assert result["ok"] is True
        assert result["reason_code"] == "valid"
        assert result["detected_language"] == "en"  # English input detected
        # user_message should be in English
        assert "processing" in result["user_message"].lower() or "ready" in result["user_message"].lower()
    
    def test_valid_chart_prompt_vietnamese(self, guard, mock_client):
        """Test: valid Vietnamese chart prompt - output in Vietnamese"""
        # Mock LLM response (accepts Vietnamese input, returns Vietnamese output)
        mock_response = Mock()
        mock_response.choices = [
            Mock(message=Mock(content='{"detected_language": "vi", "ok": true, "reason_code": "valid", "reason": "Clear chart request", "user_message": "Sẵn sàng. Đang xử lý yêu cầu của bạn..."}'))
        ]
        mock_client.get_completion.return_value = mock_response
        
        result = guard.validate("Vẽ biểu đồ line doanh thu theo tháng")
        assert result["ok"] is True
        assert result["reason_code"] == "valid"
        assert result["detected_language"] == "vi"  # Vietnamese input detected
        # user_message should be in Vietnamese
        assert "xử lý" in result["user_message"].lower() or "sẵn sàng" in result["user_message"].lower()
    
    def test_valid_chart_prompt_french(self, guard, mock_client):
        """Test: valid French chart prompt - output in French"""
        # Mock LLM response (accepts French input, returns French output)
        mock_response = Mock()
        mock_response.choices = [
            Mock(message=Mock(content='{"detected_language": "fr", "ok": true, "reason_code": "valid", "reason": "Clear chart request", "user_message": "Prêt. Traitement de votre demande..."}'))
        ]
        mock_client.get_completion.return_value = mock_response
        
        result = guard.validate("Créer un graphique linéaire des ventes par mois")
        assert result["ok"] is True
        assert result["reason_code"] == "valid"
        assert result["detected_language"] == "fr"  # French input detected
        # user_message should be in French
        assert "traitement" in result["user_message"].lower() or "prêt" in result["user_message"].lower()
    
    def test_spam_prompt(self, guard, mock_client):
        """Test: spam/gibberish prompt should be rejected with English message"""
        # Mock LLM response - output in English (default for unrecognized language)
        mock_response = Mock()
        mock_response.choices = [
            Mock(message=Mock(content='{"detected_language": "en", "ok": false, "reason_code": "spam", "reason": "Meaningless content", "user_message": "That request doesn\'t make sense. Please enter a clear chart visualization request."}'))
        ]
        mock_client.get_completion.return_value = mock_response
        
        result = guard.validate("asdfgh 123123 aaaaaa")
        assert result["ok"] is False
        assert result["reason_code"] == "spam"
        assert result["detected_language"] == "en"  # Default to English when unclear
        # user_message should be in English
        assert "sense" in result["user_message"].lower() or "clear" in result["user_message"].lower()
    
    def test_off_topic_prompt(self, guard, mock_client):
        """Test: off-topic prompt should be rejected with Vietnamese message"""
        # Mock LLM response - output in Vietnamese (detected from input)
        mock_response = Mock()
        mock_response.choices = [
            Mock(message=Mock(content='{"detected_language": "vi", "ok": false, "reason_code": "not_chart_related", "reason": "Not related to visualization", "user_message": "Đó không liên quan đến biểu đồ. Bạn muốn tạo biểu đồ gì?"}'))
        ]
        mock_client.get_completion.return_value = mock_response
        
        result = guard.validate("Làm sao để nấu cơm chin tốt?")
        assert result["ok"] is False
        assert result["reason_code"] == "not_chart_related"
        assert result["detected_language"] == "vi"  # Vietnamese input detected
        # user_message should be in Vietnamese
        assert "biểu đồ" in result["user_message"].lower()
    
    def test_vague_prompt(self, guard, mock_client):
        """Test: vague prompt should be rejected with Vietnamese message"""
        # Mock LLM response - output in Vietnamese (detected from input)
        mock_response = Mock()
        mock_response.choices = [
            Mock(message=Mock(content='{"detected_language": "vi", "ok": false, "reason_code": "too_vague", "reason": "No specific chart type mentioned", "user_message": "Vui lòng chỉ định loại biểu đồ: \'vẽ biểu đồ line\', \'bar chart\', \'pie chart\', \'scatter plot\', v.v."}'))
        ]
        mock_client.get_completion.return_value = mock_response
        
        result = guard.validate("vẽ cái gì đó")
        assert result["ok"] is False
        assert result["reason_code"] == "too_vague"
        assert result["detected_language"] == "vi"  # Vietnamese input detected
        # user_message should be in Vietnamese
        assert "chỉ định" in result["user_message"].lower() or "biểu đồ" in result["user_message"].lower()
    
    def test_json_decode_error(self, guard, mock_client):
        """Test: handle JSON decode errors gracefully with English fallback"""
        # Mock invalid JSON response
        mock_response = Mock()
        mock_response.choices = [
            Mock(message=Mock(content='invalid json {{{'))
        ]
        mock_client.get_completion.return_value = mock_response
        
        result = guard.validate("Draw a chart")
        # Should reject on error with guard_error code and English message
        assert result["ok"] is False
        assert result["reason_code"] == "guard_error"
        assert result["detected_language"] == "en"  # Default to English on error
        assert result["user_message"] is not None
        assert "error" in result["user_message"].lower() or "try again" in result["user_message"].lower()
    
    def test_api_error(self, guard, mock_client):
        """Test: handle API errors gracefully with English fallback"""
        # Mock API error
        mock_client.get_completion.side_effect = Exception("API Error")
        
        result = guard.validate("Draw a chart")
        # Should reject on error with guard_error code and English message
        assert result["ok"] is False
        assert result["reason_code"] == "guard_error"
        assert result["detected_language"] == "en"  # Default to English on error
        assert result["user_message"] is not None
        assert "error" in result["user_message"].lower()  # Message should be in English
    
    def test_qc_chart_with_qc_data(self, guard, mock_client):
        """Test: QC chart type with actual QC data should be valid"""
        # Mock LLM response - should accept
        mock_response = Mock()
        mock_response.choices = [
            Mock(message=Mock(content='{"detected_language": "en", "ok": true, "reason_code": "valid", "reason": "QC chart with QC data", "user_message": "Ready. Processing your request..."}'))
        ]
        mock_client.get_completion.return_value = mock_response
        
        # QC data must have: TARGET + at least one of (LL, UL, ARLL, ARUL)
        qc_columns = ['VALUE', 'TARGET', 'LL', 'UL', 'QCSTDPARAMNAME', 'QCDATE']
        result = guard.validate("Draw a QC Trend Bar chart", data_columns=qc_columns)
        
        assert result["ok"] is True
        assert result["reason_code"] == "valid"
        assert result["is_qc_chart_request"] is True
        assert result["is_qc_data"] is True
    
    def test_qc_chart_without_qc_data(self, guard, mock_client):
        """Test: QC chart type without QC data should be rejected"""
        # Non-QC data columns (no TARGET or LL/UL/ARLL/ARUL)
        non_qc_columns = ['product_id', 'timestamp', 'sales', 'quantity']
        result = guard.validate("Draw a QC Trend Bar chart", data_columns=non_qc_columns)
        
        # Should reject without calling LLM
        assert result["ok"] is False
        assert result["reason_code"] == "qc_data_mismatch"
        assert result["is_qc_chart_request"] is True
        assert result["is_qc_data"] is False
        # Message should reference QC data requirements (TARGET, LL, UL, etc.)
        assert "target" in result["user_message"].lower() or "control" in result["user_message"].lower()
    
    def test_qc_chart_vietnamese_without_qc_data(self, guard, mock_client):
        """Test: Vietnamese QC chart request without QC data should be rejected in Vietnamese"""
        # Non-QC data (missing TARGET and control limit columns)
        non_qc_columns = ['product_id', 'timestamp', 'sales']
        result = guard.validate("vẽ biểu đồ qc trend line", data_columns=non_qc_columns)
        
        # Should reject and detect Vietnamese
        assert result["ok"] is False
        assert result["reason_code"] == "qc_data_mismatch"
        assert result["is_qc_chart_request"] is True
        assert result["is_qc_data"] is False
        assert result["detected_language"] == "vi"
        # Message should be in Vietnamese and mention QC requirements
        assert "qc" in result["user_message"].lower() or "biểu đồ" in result["user_message"].lower()
    
    def test_non_qc_chart_with_qc_data(self, guard, mock_client):
        """Test: Regular chart type with QC data should be valid"""
        # Mock LLM response
        mock_response = Mock()
        mock_response.choices = [
            Mock(message=Mock(content='{"detected_language": "en", "ok": true, "reason_code": "valid", "reason": "Regular chart with any data", "user_message": "Ready. Processing your request..."}'))
        ]
        mock_client.get_completion.return_value = mock_response
        
        qc_columns = ['VALUE', 'LL', 'UL', 'CENTER_LINE']
        result = guard.validate("Draw a line chart", data_columns=qc_columns)
        
        # Should be valid - no mismatch for non-QC chart types
        assert result["ok"] is True
        assert result["is_qc_chart_request"] is False
