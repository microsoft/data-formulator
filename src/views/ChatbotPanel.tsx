// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
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
import { AppDispatch } from "../app/store";
import { DataFormulatorState } from "../app/dfSlice";
import * as dfActions from "../app/dfSlice";
import { ChatMessage } from "../app/dfSlice";

// CSS keyframes for loading message animation (ChatGPT style)
const loadingAnimationStyles = `
  @keyframes typingAnimation {
    0%, 20%, 100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }
  .loading-message {
    opacity: 0.8;
  }
  .loading-message::after {
    content: '';
    animation: typingAnimation 1.4s infinite;
  }
`;

// Inject styles
const styleSheet = document.createElement("style");
styleSheet.textContent = loadingAnimationStyles;
document.head.appendChild(styleSheet);

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
  const dispatch = useDispatch<AppDispatch>();
  const chatHistory = useSelector(
    (state: DataFormulatorState) => state.chatHistory
  );
  const [chatInput, setChatInput] = useState<string>("");
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [expandedVideo, setExpandedVideo] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Function to extract YouTube video ID from URL
  const extractYouTubeId = (url: string): string | null => {
    const youtubeRegex =
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(youtubeRegex);
    return match ? match[1] : null;
  };

  // Function to check if it's a local network video (UNC path or IP-based video)
  const isLocalNetworkVideo = (text: string): string | null => {
    // UNC path: \\ip\share\path or //ip/share/path
    // Match backslash paths: \\ or forward slash paths: //
    const uncPathRegex =
      /(\\\\?[^\s]+\.(mp4|avi|mov|mkv)|\/\/[^\s]+\.(mp4|avi|mov|mkv))/i;
    const match = text.match(uncPathRegex);
    if (match) {
      return match[0];
    }
    return null;
  };

  // Function to convert URLs in text to clickable links or embedded videos
  const renderMessageWithLinks = (text: string) => {
    // Split by newlines to handle paragraphs
    const paragraphs = text.split("\n").filter((p) => p.trim() !== "");

    // Process each paragraph
    const processedParagraphs = paragraphs.map((paragraph, paraIndex) => {
      // Check for local network video first (UNC path)
      const localVideoPath = isLocalNetworkVideo(paragraph);
      if (localVideoPath) {
        const isExpanded = expandedVideo === localVideoPath;

        // Get text before and after video path
        const textBefore = paragraph
          .substring(0, paragraph.indexOf(localVideoPath))
          .trim();
        const textAfter = paragraph
          .substring(paragraph.indexOf(localVideoPath) + localVideoPath.length)
          .trim();

        return (
          <Box
            key={`para-${paraIndex}`}
            sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 1.5 }}
          >
            {textBefore && (
              <Typography variant="body2" sx={{ color: "inherit" }}>
                {textBefore}
              </Typography>
            )}
            <Box
              sx={{
                marginTop: 1,
                marginBottom: 1,
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              <video
                width={isExpanded ? "100%" : "280"}
                height={isExpanded ? "400" : "157"}
                controls
                style={{
                  borderRadius: "8px",
                  backgroundColor: "#000",
                  transition: "all 0.3s ease",
                }}
              >
                <source
                  src={`/api/chatbot/video?path=${encodeURIComponent(
                    localVideoPath
                  )}`}
                  type="video/mp4"
                />
                Your browser does not support the video tag.
              </video>
              <Box
                sx={{
                  display: "flex",
                  gap: 1,
                }}
              ></Box>
            </Box>
            {textAfter && (
              <Typography variant="body2" sx={{ color: "inherit" }}>
                {textAfter}
              </Typography>
            )}
            <Typography
              variant="caption"
              sx={{
                color: "#999",
                fontSize: "11px",
                wordBreak: "break-all",
              }}
            >
              {localVideoPath}
            </Typography>
          </Box>
        );
      }

      // Regex to match: http/https URLs, www URLs, IP addresses (with or without port), and domain names
      const urlRegex =
        /(https?:\/\/[^\s]+|www\.[^\s]+|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/[^\s]*)?|google\.com)/g;
      const parts: (string | React.ReactElement)[] = [];
      let lastIndex = 0;
      let match;

      while ((match = urlRegex.exec(paragraph)) !== null) {
        // Add text before URL
        if (match.index > lastIndex) {
          parts.push(paragraph.substring(lastIndex, match.index));
        }

        // Add URL as clickable link or embedded video
        let url = match[0];
        if (!url.startsWith("http")) {
          // Check if it's an IP address
          if (/^\d{1,3}\./.test(url)) {
            url = `http://${url}`;
          } else {
            url = `https://${url}`;
          }
        }

        // Check if it's a YouTube link
        const youtubeId = extractYouTubeId(url);
        if (youtubeId) {
          const isExpanded = expandedVideo === youtubeId;
          parts.push(
            <Box
              key={`video-${youtubeId}`}
              sx={{
                marginTop: 1,
                marginBottom: 1,
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              <iframe
                width={isExpanded ? "100%" : "280"}
                height={isExpanded ? "400" : "157"}
                src={`https://www.youtube.com/embed/${youtubeId}`}
                title="YouTube video"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{
                  borderRadius: "8px",
                  transition: "all 0.3s ease",
                }}
              />
              <Box
                sx={{
                  display: "flex",
                  gap: 1,
                }}
              >
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: "4px 12px",
                    fontSize: "12px",
                    backgroundColor: "#1976d2",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    textDecoration: "none",
                    fontWeight: 500,
                  }}
                >
                  Open in YouTube
                </a>
              </Box>
            </Box>
          );
        } else {
          parts.push(
            <a
              key={`url-${paraIndex}-${parts.length}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#1976d2",
                textDecoration: "underline",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              {match[0]}
            </a>
          );
        }

        lastIndex = urlRegex.lastIndex;
      }

      // Add remaining text after last URL
      if (lastIndex < paragraph.length) {
        parts.push(paragraph.substring(lastIndex));
      }

      // If no parts, return plain text
      if (parts.length === 0) {
        return (
          <Typography
            key={`para-${paraIndex}`}
            variant="body2"
            sx={{ color: "inherit", mb: 1 }}
          >
            {paragraph}
          </Typography>
        );
      }

      // If all parts are strings, return as Typography
      if (parts.every((p) => typeof p === "string")) {
        return (
          <Typography
            key={`para-${paraIndex}`}
            variant="body2"
            sx={{ color: "inherit", mb: 1 }}
          >
            {parts.join("")}
          </Typography>
        );
      }

      // If mixed content (text + links), wrap in Box with Typography styling
      return (
        <Box
          key={`para-${paraIndex}`}
          sx={{ fontSize: "0.875rem", color: "inherit", mb: 1 }}
        >
          {parts}
        </Box>
      );
    });

    // If only one paragraph, return it directly without wrapper
    if (processedParagraphs.length === 1) {
      return processedParagraphs[0];
    }

    // Return all paragraphs wrapped in a container
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        {processedParagraphs}
      </Box>
    );
  };

  // Auto-scroll to bottom of chat when new messages arrive
  useEffect(() => {
    if (chatEndRef.current?.parentElement) {
      chatEndRef.current.parentElement.scrollTop =
        chatEndRef.current.parentElement.scrollHeight;
    }
  }, [chatHistory]);

  // Scroll to bottom when chat opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (chatEndRef.current?.parentElement) {
          chatEndRef.current.parentElement.scrollTop =
            chatEndRef.current.parentElement.scrollHeight;
        }
      }, 100);
    }
  }, [isOpen]);

  // Animated dots for loading message
  useEffect(() => {
    if (!chatLoading) return;

    const interval = setInterval(() => {
      // This interval is kept for timing but no longer updates state
    }, 500);

    return () => clearInterval(interval);
  }, [chatLoading]);

  // Update loading message with animated dots
  useEffect(() => {
    // This effect is no longer needed since we removed dotCount
    return;
  }, [chatLoading]);

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;

    const messageText = chatInput;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: messageText,
      sender: "user",
      timestamp: Date.now(),
    };

    dispatch(dfActions.dfActions.addChatMessage(userMessage));
    setChatInput("");
    setChatLoading(true);

    // Add loading message immediately
    const loadingMessageId = (Date.now() + 1).toString();
    const loadingMessage: ChatMessage = {
      id: loadingMessageId,
      text: "Đang xử lý...",
      sender: "bot",
      timestamp: Date.now(),
    };
    dispatch(dfActions.dfActions.addChatMessage(loadingMessage));

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
        // Replace loading message with actual response
        const botMessage: ChatMessage = {
          id: loadingMessageId, // Use same ID to replace the loading message
          text: data.reply,
          sender: "bot",
          timestamp: Date.now(),
        };
        // Remove loading message first, then add the real one
        dispatch(dfActions.dfActions.removeChatMessage(loadingMessageId));
        dispatch(dfActions.dfActions.addChatMessage(botMessage));
      } else {
        throw new Error(data.message || "Failed to get response");
      }
    } catch (err) {
      console.error("Chatbot error:", err);
      // Replace loading message with error message
      dispatch(dfActions.dfActions.removeChatMessage(loadingMessageId));
      const errorMessage: ChatMessage = {
        id: (Date.now() + 2).toString(),
        text: "Xin lỗi, có lỗi xảy ra. Vui lòng thử lại.",
        sender: "bot",
        timestamp: Date.now(),
      };
      dispatch(dfActions.dfActions.addChatMessage(errorMessage));
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
            {chatHistory.length === 0 && (
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

            {chatHistory.map((msg: ChatMessage) => (
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
                  className={
                    msg.sender === "bot" && msg.text === "Đang xử lý..."
                      ? "loading-message"
                      : ""
                  }
                >
                  <Box
                    sx={{
                      wordBreak: "break-word",
                      lineHeight: 1.4,
                    }}
                  >
                    {/^\\.+$/.test(msg.text) ? (
                      <span className="animated-dots">{msg.text}</span>
                    ) : (
                      renderMessageWithLinks(msg.text)
                    )}
                  </Box>
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
                    {new Date(msg.timestamp).toLocaleTimeString("en-US", {
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
