// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState, useEffect, useRef } from "react";
import chatbotGif from "../assets/gdis-chat-bot.gif";
import {
  Box,
  Paper,
  Typography,
  TextField,
  IconButton,
  Divider,
  Avatar,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";

interface ChatMessage {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp: Date;
}

interface ChatbotPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
}

export const ChatbotPanel: React.FC<ChatbotPanelProps> = ({
  isOpen,
  onClose,
  onOpen,
}) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat when new messages arrive
  useEffect(() => {
    if (chatEndRef.current?.parentElement) {
      chatEndRef.current.parentElement.scrollTop =
        chatEndRef.current.parentElement.scrollHeight;
    }
  }, [chatMessages]);

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;

    const messageText = chatInput;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: messageText,
      sender: "user",
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);

    try {
      const response = await fetch("/api/chatbot/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          message: messageText,
        }),
      });

      const data = await response.json();

      if (data.status === "success") {
        const botMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          text: data.reply,
          sender: "bot",
          timestamp: new Date(),
        };
        setChatMessages((prev) => [...prev, botMessage]);
      } else {
        throw new Error(data.message || "Failed to get response");
      }
    } catch (err) {
      console.error("Chatbot error:", err);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <>
      {/* Chatbot Panel */}
      {isOpen && (
        <Paper
          sx={{
            flex: "0 0 30%",
            p: 0,
            backgroundColor: "#ffffff",
            borderRadius: "16px",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.15)",
            display: "flex",
            flexDirection: "column",
            height: "70vh",
            overflow: "hidden",
            background: "linear-gradient(135deg, #f5f7fa 0%, #ffffff 100%)",
          }}
        >
          {/* Header */}
          <Box
            sx={{
              p: 2.5,
              background: "linear-gradient(135deg, #1976d2 0%, #1565c0 100%)",
              color: "white",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              boxShadow: "0 4px 12px rgba(25, 118, 210, 0.2)",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Avatar
                src={chatbotGif}
                sx={{ width: 40, height: 40, border: "2px solid white" }}
              />
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: "16px" }}>
                  Dashboard Assistant
                </Typography>
                <Typography
                  sx={{
                    fontSize: "12px",
                    opacity: 0.8,
                  }}
                >
                  Always here to help
                </Typography>
              </Box>
            </Box>
            <IconButton
              size="small"
              onClick={onClose}
              sx={{
                color: "white",
                "&:hover": {
                  backgroundColor: "rgba(255, 255, 255, 0.2)",
                },
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* Chat Messages Area */}
          <Box
            sx={{
              flex: 1,
              overflowY: "auto",
              p: 2,
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              backgroundColor: "#fafbfc",
              "&::-webkit-scrollbar": {
                width: "6px",
              },
              "&::-webkit-scrollbar-track": {
                backgroundColor: "rgba(0,0,0,0.05)",
              },
              "&::-webkit-scrollbar-thumb": {
                backgroundColor: "rgba(0,0,0,0.2)",
                borderRadius: "3px",
                "&:hover": {
                  backgroundColor: "rgba(0,0,0,0.3)",
                },
              },
            }}
          >
            {chatMessages.length === 0 && (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  gap: 2,
                }}
              >
                <Avatar
                  src={chatbotGif}
                  sx={{
                    width: 60,
                    height: 60,
                    opacity: 0.6,
                  }}
                />
                <Box sx={{ textAlign: "center" }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      color: "text.primary",
                      mb: 0.5,
                    }}
                  >
                    Welcome!
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Ask me anything about your dashboards
                  </Typography>
                </Box>
              </Box>
            )}

            {chatMessages.map((msg) => (
              <Box
                key={msg.id}
                sx={{
                  display: "flex",
                  justifyContent:
                    msg.sender === "user" ? "flex-end" : "flex-start",
                  animation: "fadeIn 0.3s ease-in",
                  "@keyframes fadeIn": {
                    from: {
                      opacity: 0,
                      transform:
                        msg.sender === "user"
                          ? "translateX(10px)"
                          : "translateX(-10px)",
                    },
                    to: {
                      opacity: 1,
                      transform: "translateX(0)",
                    },
                  },
                }}
              >
                {msg.sender === "bot" && (
                  <Avatar
                    src={chatbotGif}
                    sx={{
                      width: 32,
                      height: 32,
                      mr: 1,
                      flexShrink: 0,
                    }}
                  />
                )}
                <Box
                  sx={{
                    maxWidth: "65%",
                    px: 2,
                    py: 1.2,
                    borderRadius:
                      msg.sender === "user"
                        ? "16px 16px 4px 16px"
                        : "16px 16px 16px 4px",
                    backgroundColor:
                      msg.sender === "user"
                        ? "linear-gradient(135deg, #1976d2 0%, #1565c0 100%)"
                        : "#e8f0f8",
                    color: msg.sender === "user" ? "#000000" : "text.primary",
                    boxShadow:
                      msg.sender === "user"
                        ? "0 2px 8px rgba(25, 118, 210, 0.2)"
                        : "0 2px 4px rgba(0,0,0,0.05)",
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      color: "inherit",
                      wordBreak: "break-word",
                      lineHeight: 1.4,
                    }}
                  >
                    {msg.text}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      mt: 0.5,
                      opacity: 0.7,
                      color: "inherit",
                      fontSize: "11px",
                    }}
                  >
                    {msg.timestamp.toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Typography>
                </Box>
              </Box>
            ))}
            <div ref={chatEndRef} />
          </Box>

          {/* Input Area */}
          <Box
            sx={{
              p: 2,
              backgroundColor: "#ffffff",
              borderTop: "1px solid rgba(0,0,0,0.08)",
            }}
          >
            <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Type your message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={chatLoading}
                multiline
                maxRows={3}
                sx={{
                  "& .MuiOutlinedInput-root": {
                    borderRadius: "12px",
                    backgroundColor: "#f5f7fa",
                    "&:hover": {
                      backgroundColor: "#f0f3f7",
                    },
                    "&.Mui-focused": {
                      backgroundColor: "#ffffff",
                      "& fieldset": {
                        borderColor: "#1976d2",
                        borderWidth: "2px",
                      },
                    },
                  },
                  "& .MuiOutlinedInput-input": {
                    fontSize: "14px",
                    "&::placeholder": {
                      opacity: 0.6,
                    },
                  },
                }}
              />
              <IconButton
                onClick={handleSendMessage}
                disabled={!chatInput.trim() || chatLoading}
                sx={{
                  backgroundColor: "#1976d2",
                  color: "white",
                  width: 40,
                  height: 40,
                  flexShrink: 0,
                  "&:hover:not(:disabled)": {
                    backgroundColor: "#1565c0",
                    boxShadow: "0 4px 12px rgba(25, 118, 210, 0.3)",
                  },
                  "&:disabled": {
                    opacity: 0.5,
                  },
                }}
              >
                <SendIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          </Box>
        </Paper>
      )}

      {/* Floating Chatbot Button */}
      {!isOpen && (
        <Box
          onClick={onOpen}
          sx={{
            position: "fixed",
            top: "70vh",
            right: 32,
            width: 80,
            height: 80,
            borderRadius: "50%",
            cursor: "pointer",
            background: "white",
            boxShadow: "0 4px 12px rgba(25, 118, 210, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.3s ease",
            zIndex: 1000,
            "&:hover": {
              transform: "scale(1.1)",
              boxShadow: "0 8px 20px rgba(25, 118, 210, 0.4)",
            },
          }}
        >
          <img
            src={chatbotGif}
            alt="Chat Bot"
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              objectFit: "cover",
            }}
          />
        </Box>
      )}
    </>
  );
};

export default ChatbotPanel;
