import { createSignal, createEffect, createMemo, For, onCleanup, onMount } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  tools?: { id?: string; name: string; status: 'running' | 'success' | 'error'; output?: string; resultMsgId?: string }[];
}

export default function ChatInterface() {
  const [messages, setMessages] = createStore<ChatMessage[]>([]);
  const [input, setInput] = createSignal('');
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [isConnected, setIsConnected] = createSignal(false);
  const [showModal, setShowModal] = createSignal<'skill' | 'extension' | null>(null);
  const [commandsList, setCommandsList] = createSignal<{name: string, source: string, description?: string}[]>([]);
  const [resourcesList, setResourcesList] = createSignal<{name: string, source: string, description?: string}[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const filteredCommands = createMemo(() => {
    const text = input();
    if (!text.startsWith('/')) return null;
    
    // Extract the word immediately after the slash
    const match = text.match(/^\/(\S*)/);
    if (!match) return null;
    
    const query = match[1].toLowerCase();
    const matches = commandsList().filter(cmd => 
      cmd.name.toLowerCase().includes(query)
    );
    
    return matches.length > 0 ? matches : null;
  });

  createEffect(() => {
    // Reset selected index when filtered list changes
    filteredCommands();
    setSelectedIndex(0);
  });
  
  let messagesEndRef: HTMLDivElement | undefined;
  let eventSource: EventSource | null = null;
  
  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
  };
  
  createEffect(() => {
    messages.length; // Trigger effect on message count change
    scrollToBottom();
  });

  onMount(() => {
    fetchHistory();
    fetchCommands();
    fetchResources();
    connectSSE();
  });

  const fetchCommands = async () => {
    try {
      const res = await fetch('/api/commands');
      if (res.ok) {
        const data = await res.json();
        setCommandsList(data.commands || []);
      }
    } catch (e) {
      console.error('Failed to fetch commands', e);
    }
  };

  const fetchResources = async () => {
    try {
      const res = await fetch('/api/resources');
      if (res.ok) {
        const data = await res.json();
        setResourcesList(data.resources || []);
      }
    } catch (e) {
      console.error('Failed to fetch resources', e);
    }
  };
  
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      
      const mapped: ChatMessage[] = [];
      let currentAssistantMessage: ChatMessage | null = null;

      for (const m of (data.messages || [])) {
        if (m.role === 'user') {
          let contentStr = '';
          if (typeof m.content === 'string') {
            contentStr = m.content;
          } else if (Array.isArray(m.content)) {
            contentStr = m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
          }
          
          mapped.push({
            id: m.id || Math.random().toString(),
            role: 'user',
            content: contentStr
          });
          currentAssistantMessage = null;
        } else if (m.role === 'assistant') {
          let contentStr = '';
          const tools: any[] = [];
          
          if (typeof m.content === 'string') {
            contentStr = m.content;
          } else if (Array.isArray(m.content)) {
            m.content.forEach((c: any) => {
              if (c.type === 'text') {
                contentStr += c.text;
              } else if (c.type === 'toolCall') {
                tools.push({
                  id: c.id,
                  name: c.name,
                  status: 'running', 
                  output: ''
                });
              }
            });
          }
          
          const msg: ChatMessage = {
            id: m.id || Math.random().toString(),
            role: 'assistant',
            content: contentStr,
            tools
          };
          mapped.push(msg);
          currentAssistantMessage = msg;
        } else if (m.role === 'toolResult' && currentAssistantMessage && currentAssistantMessage.tools) {
          const tool = currentAssistantMessage.tools.find(t => t.id === m.toolCallId);
          if (tool) {
            let resultStr = '';
            if (typeof m.content === 'string') {
              resultStr = m.content;
            } else if (Array.isArray(m.content)) {
              resultStr = m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
            }
            tool.output = resultStr;
            tool.status = m.isError ? 'error' : 'success';
          }
        }
      }
        
      setMessages(mapped);
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  };
  
  onCleanup(() => {
    if (eventSource) {
      eventSource.close();
    }
  });

  const connectSSE = () => {
    eventSource = new EventSource('/api/stream');
    
    eventSource.onopen = () => {
      console.log('SSE connection opened');
    };
    
    eventSource.onerror = (err) => {
      console.error('SSE error', err);
      setIsConnected(false);
    };

    eventSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      
      if (data.type === 'connection_established') {
        setIsConnected(true);
        return;
      }
      
      handleAgentEvent(data);
    };
  };

  const handleAgentEvent = (event: any) => {
    const lastIdx = messages.length - 1;

    if (event.type === 'message_start') {
      const msgId = event.message?.id || event.message?.responseId || Date.now().toString();
      
      if (event.message.role === 'assistant') {
        setMessages(messages.length, { id: msgId, role: 'assistant', content: '', isStreaming: true });
      } else if (event.message.role === 'toolResult') {
        const toolCallId = event.message.toolCallId;
        let initialOutput = '';
        
        if (typeof event.message.content === 'string') {
          initialOutput = event.message.content;
        } else if (Array.isArray(event.message.content)) {
          initialOutput = event.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('');
        }

        setMessages(
          m => m.role === 'assistant' && !!m.tools?.some(t => t.id === toolCallId), 
          'tools', 
          t => t.id === toolCallId,
          tool => ({ 
            ...tool, 
            resultMsgId: msgId, 
            status: event.message.isError ? 'error' : 'success', 
            output: initialOutput || tool.output 
          })
        );
      }
    } else if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      const msgId = event.message?.id || event.message?.responseId;
      
      const isToolResult = msgId 
        ? messages.some(m => m.tools?.some(t => t.resultMsgId === msgId))
        : (event.message?.role === 'toolResult' || !!event.message?.toolCallId);

      if (isToolResult) {
        const toolCallId = event.message?.toolCallId;
        if (toolCallId) {
          setMessages(
            m => m.role === 'assistant' && !!m.tools?.some(t => t.id === toolCallId),
            'tools',
            t => t.id === toolCallId,
            tool => ({ ...tool, output: (tool.output || '') + event.assistantMessageEvent.delta })
          );
        } else if (msgId) {
          setMessages(
            m => m.role === 'assistant' && !!m.tools?.some(t => t.resultMsgId === msgId),
            'tools',
            t => t.resultMsgId === msgId,
            tool => ({ ...tool, output: (tool.output || '') + event.assistantMessageEvent.delta })
          );
        }
      } else {
        if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
          setMessages(lastIdx, 'content', (c) => (c || '') + event.assistantMessageEvent.delta);
        }
      }
    } else if (event.type === 'message_end') {
      setMessages(m => m.isStreaming === true, 'isStreaming', false);
    } else if (event.type === 'agent_start') {
      setIsProcessing(true);
    } else if (event.type === 'agent_end') {
      setIsProcessing(false);
      setMessages(m => m.isStreaming === true, 'isStreaming', false);
    } else if (event.type === 'tool_execution_start') {
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        const toolName = event.toolName || event.name || (event.toolCall && event.toolCall.name) || 'tool';
        setMessages(lastIdx, 'tools', (t) => [...(t || []), { 
          id: event.toolCallId, 
          name: toolName, 
          status: 'running' 
        }]);
      }
    } else if (event.type === 'tool_execution_update') {
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        setMessages(lastIdx, 'tools', (tools) => 
          tools ? tools.map((t) => (t.id === event.toolCallId || !t.id) ? { ...t, output: (t.output || '') + (event.delta || '') } : t) : []
        );
      }
    } else if (event.type === 'tool_execution_end') {
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        setMessages(lastIdx, 'tools', (tools) => 
          tools ? tools.map((t) => (t.id === event.toolCallId || !t.id) ? { ...t, status: event.isError ? 'error' : 'success' } : t) : []
        );
      }
    }
  };

  const handleSubmit = async (e?: Event) => {
    e?.preventDefault();
    if (!input().trim()) return;

    const userMessage = input();
    setInput('');
    
    // Add optimistic user message
    setMessages(messages.length, { id: Date.now().toString(), role: 'user', content: userMessage });
    
    setIsProcessing(true);
    
    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userMessage }),
      });
    } catch (err) {
      console.error('Failed to send message:', err);
      setIsProcessing(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const commands = filteredCommands();
    
    if (commands) {
      // In a drop-up, ArrowUp moves visually UP (away from input) -> higher index
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % commands.length);
        return;
      } 
      // ArrowDown moves visually DOWN (towards input) -> lower index
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + commands.length) % commands.length);
        return;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        applyCommand(commands[selectedIndex()]);
        return;
      } else if (e.key === 'Escape') {
        // Just let it be, or we could clear the slash
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const applyCommand = (cmd: { name: string }) => {
    // Replace the initial slash word with the completed command
    const text = input();
    const replaced = text.replace(/^\/\S*/, `/${cmd.name} `);
    setInput(replaced);
    setSelectedIndex(0);
  };

  const renderMarkdown = (content: string) => {
    if (!content) return '';
    try {
      const rawHtml = marked.parse(content, { async: false }) as string;
      return DOMPurify.sanitize(rawHtml);
    } catch {
      return content;
    }
  };

  return (
    <div class="chat-container">
      <div class="system-status">
        <div>{isConnected ? '🟢 Agent Connected' : '🔴 Agent Disconnected'}</div>
        <div style="display: flex; gap: 0.5rem;">
          <button 
            class="system-status-btn"
            onClick={() => setShowModal('skill')}
          >
            🤹 Skills
          </button>
          <button 
            class="system-status-btn"
            onClick={() => setShowModal('extension')}
          >
            🧩 Extensions
          </button>
        </div>
      </div>

      {showModal() && (
        <div class="skills-modal-overlay">
          <div class="skills-modal">
            <div class="skills-modal-header">
              <h2 class="skills-modal-title">
                {showModal() === 'skill' ? 'Skills' : 'Extensions'}
              </h2>
              <button onClick={() => setShowModal(null)} class="skills-modal-close">✕</button>
            </div>
            <div class="skills-modal-body">
              {resourcesList().filter(r => r.source === showModal()).length === 0 ? (
                <div class="skills-modal-empty">No {showModal()}s loaded.</div>
              ) : (
                <div class="skills-list">
                  <For each={resourcesList().filter(r => r.source === showModal())}>
                    {(res) => (
                      <div class="skill-card">
                        <div class="skill-card-header">
                          <span class="skill-card-name">{res.name}</span>
                          <span class="skill-card-source">{res.source}</span>
                        </div>
                        {res.description && <div class="skill-card-desc">{res.description}</div>}
                      </div>
                    )}
                  </For>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      <div class="messages-area">
        <For each={messages}>
          {(msg) => (
            <div class={`message ${msg.role}`}>
              <div class="message-bubble">
                <div 
                  class="message-content" 
                  innerHTML={renderMarkdown(msg.content)} 
                />
                
                {msg.tools && msg.tools.length > 0 && (
                  <div class="tool-executions">
                    <For each={msg.tools}>
                      {(tool) => (
                        <div class="tool-execution">
                          <div class={`tool-header ${tool.status}`}>
                            <span class="tool-icon">
                              {tool.status === 'running' ? '⏳' : tool.status === 'error' ? '❌' : '✅'}
                            </span>
                            <span class="tool-name">{tool.name}</span>
                          </div>
                          {tool.output && (
                            <div class="tool-body">
                              {tool.output}
                            </div>
                          )}
                        </div>
                      )}
                    </For>
                  </div>
                )}
                
                {msg.isStreaming && (
                  <div class="thinking-indicator">
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                  </div>
                )}
              </div>
            </div>
          )}
        </For>
        
        {isProcessing && !messages.find(m => m.isStreaming) && (
          <div class="message assistant">
            <div class="message-bubble">
              <div class="thinking-indicator">
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div class="input-area relative">
        {filteredCommands() && (
          <div class="autocomplete-popup">
            <div class="autocomplete-header">
              Slash Commands
            </div>
            <div class="autocomplete-list">
              <For each={[...filteredCommands()!].reverse()}>
                {(cmd, index) => {
                  const originalIndex = () => filteredCommands()!.length - 1 - index();
                  return (
                    <div 
                      class={`autocomplete-item ${originalIndex() === selectedIndex() ? 'selected' : ''}`}
                      onClick={() => applyCommand(cmd)}
                    >
                      <div class="autocomplete-item-title">
                        <span class="autocomplete-item-name">/{cmd.name}</span>
                        <span class="autocomplete-item-source">{cmd.source}</span>
                      </div>
                      {cmd.description && <span class="autocomplete-item-desc">{cmd.description}</span>}
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        )}
        <textarea
          class="input-field"
          placeholder="Send a message to Sylph..."
          value={input()}
          onInput={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={!isConnected}
        />
        <button 
          class="send-button" 
          onClick={() => handleSubmit()}
          disabled={!input().trim() || !isConnected}
          title="Send message"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    </div>
  );
}
