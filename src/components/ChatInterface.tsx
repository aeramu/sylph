import { createSignal, createEffect, createMemo, For, Show, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import CustomSelect from './CustomSelect';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  tools?: { id?: string; name: string; status: 'running' | 'success' | 'error'; output?: string; resultMsgId?: string }[];
}

export default function ChatInterface(props: { activeSessionId?: string, activeProjectId?: string, onSelectProject?: (id: string) => void, onSessionCreated: (id: string, projectId?: string) => void, onStreamStart?: () => void }) {
  const [messages, setMessages] = createStore<ChatMessage[]>([]);
  const [input, setInput] = createSignal('');
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [isConnected, setIsConnected] = createSignal(false);
  const [showModal, setShowModal] = createSignal<'skill' | 'extension' | null>(null);
  const [commandsList, setCommandsList] = createSignal<{name: string, source: string, description?: string}[]>([]);
  const [resourcesList, setResourcesList] = createSignal<{name: string, source: string, description?: string}[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [projects, setProjects] = createSignal<any[]>([]);
  const [models, setModels] = createSignal<{value: string, label: string}[]>([]);
  const [selectedModel, setSelectedModel] = createSignal('');

  // Session whose creation this client just triggered; skip the history
  // reset/refetch when it becomes active so the in-flight stream isn't wiped.
  let justCreatedSessionId: string | null = null;
  // Guards fetchHistory against stale responses when switching sessions fast.
  let historyRequestSeq = 0;

  createEffect(() => {
    fetch(`/api/projects`).then(res => res.json()).then(data => {
      setProjects(data.projects || []);
    });
    
    fetch('/api/models').then(res => res.json()).then(data => {
      if (data.models && data.models.length > 0) {
        const mapped = data.models.map((m: any) => ({ value: m.id, label: m.name }));
        setModels(mapped);

        // Default to a flash model if available, otherwise the first one
        const defaultModel = mapped.find((m: any) => m.label.toLowerCase().includes('flash')) || mapped[0];
        setSelectedModel(defaultModel.value);
      }
    }).catch(console.error);
  });

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
    fetchCommands();
    fetchResources();
    connectSSE();
  });

  createEffect(() => {
    const id = props.activeSessionId; // track
    if (id && justCreatedSessionId === id) {
      // This client created the session and is already streaming into it;
      // don't wipe the optimistic messages.
      justCreatedSessionId = null;
      return;
    }
    setMessages([]);
    fetchHistory();
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
    if (!props.activeSessionId) {
      setMessages([]);
      return;
    }
    const seq = ++historyRequestSeq;
    try {
      const res = await fetch(`/api/history?sessionId=${props.activeSessionId}`);
      const data = await res.json();
      if (seq !== historyRequestSeq) return; // a newer request superseded this one

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

      // Tools with no recorded result were interrupted; don't leave them
      // spinning as "running" forever.
      for (const m of mapped) {
        m.tools?.forEach(t => {
          if (t.status === 'running') t.status = 'error';
        });
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
    if (event.sessionId) {
      if (props.activeSessionId && event.sessionId !== props.activeSessionId) {
        return;
      }
      if (!props.activeSessionId) {
        if (isProcessing()) {
          justCreatedSessionId = event.sessionId;
          props.onSessionCreated(event.sessionId);
        } else {
          return;
        }
      }
    }

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
            status: (event.message.isError ? 'error' : 'success') as 'error' | 'success', 
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
      if (props.onStreamStart) props.onStreamStart();
    } else if (event.type === 'agent_end') {
      setIsProcessing(false);
      setMessages(m => m.isStreaming === true, 'isStreaming', false);
    } else if (event.type === 'tool_execution_start') {
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        const toolName = event.toolName || event.name || (event.toolCall && event.toolCall.name) || 'tool';
        setMessages(lastIdx, 'tools', (t) => [...(t || []), { 
          id: event.toolCallId, 
          name: toolName, 
          status: 'running' as const 
        }]);
      }
    } else if (event.type === 'tool_execution_update') {
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        setMessages(lastIdx, 'tools', (tools) =>
          tools ? tools.map((t) => t.id === event.toolCallId ? { ...t, output: (t.output || '') + (event.delta || '') } : t) : []
        );
      }
    } else if (event.type === 'tool_execution_end') {
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        setMessages(lastIdx, 'tools', (tools) =>
          tools ? tools.map((t) => t.id === event.toolCallId ? { ...t, status: event.isError ? 'error' : 'success' } : t) : []
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
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: userMessage,
          sessionId: props.activeSessionId,
          project_id: props.activeProjectId,
          modelId: selectedModel() || undefined
        }),
      });
      const data = await res.json();
      if (data.sessionId && data.sessionId !== props.activeSessionId) {
        justCreatedSessionId = data.sessionId;
        props.onSessionCreated(data.sessionId, data.projectId);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setIsProcessing(false);
    }
  };

  const handleStop = async () => {
    if (!props.activeSessionId) return;
    try {
      await fetch(`/api/chat/${props.activeSessionId}/abort`, {
        method: 'POST'
      });
    } catch (err) {
      console.error('Failed to abort:', err);
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
    
    // Process <thinking> and <think> tags into collapsible <details>
    let processed = content;
    const openCount = (processed.match(/<thinking>|<think>/g) || []).length;
    const closeCount = (processed.match(/<\/thinking>|<\/think>/g) || []).length;
    
    processed = processed
      .replace(/<thinking>|<think>/g, '<details class="thinking-block" open><summary>Thinking process</summary><div class="thinking-content">\n\n')
      .replace(/<\/thinking>|<\/think>/g, '\n\n</div></details>');
      
    if (openCount > closeCount) {
      processed += '\n\n</div></details>';
    }

    try {
      const rawHtml = marked.parse(processed, { async: false }) as string;
      // Note: deliberately NOT allowing iframe or style attributes — model
      // output is untrusted and those defeat the point of sanitizing.
      return DOMPurify.sanitize(rawHtml, {
        USE_PROFILES: { html: true, svg: true },
        ADD_ATTR: ['class', 'target', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'id', 'name', 'type', 'checked', 'disabled'],
        ADD_TAGS: ['svg', 'path', 'g', 'circle', 'rect', 'line', 'polygon', 'polyline', 'defs', 'clipPath', 'text', 'details', 'summary', 'input', 'kbd', 'del']
      });
    } catch {
      return content;
    }
  };

  return (
    <div class={`chat-container ${messages.length === 0 ? 'empty-mode' : ''}`}>
      <div class="system-status">
        <div>{isConnected() ? '🟢 Agent Connected' : '🔴 Agent Disconnected'}</div>
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
        
        {isProcessing() && !messages.find(m => m.isStreaming) && (
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

      <div class="input-wrapper">
        {messages.length === 0 && (
          <div class="top-project-row">
            <CustomSelect 
              triggerClass="project-selector" 
              value={props.activeProjectId || ''} 
              onChange={(val) => {
                if (props.onSelectProject) props.onSelectProject(val);
              }}
              options={projects().map(p => ({ value: p.id, label: p.name, icon: 'folder' }))}
              placeholder="Select a Project"
              position="bottom"
            />
          </div>
        )}
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
            placeholder="Ask anything, @ to mention, / for actions"
            value={input()}
            onInput={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={!isConnected()}
          />
          <div class="input-toolbar">
            <div class="input-toolbar-left">
              <button class="input-toolbar-btn" title="Add attachment">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
              <CustomSelect
                triggerClass="model-selector"
                value={selectedModel()}
                onChange={(val) => setSelectedModel(val)}
                options={models()}
                placeholder="Default model"
                position="top"
              />
            </div>
            
            <Show when={isProcessing()}>
              <button 
                class="stop-button" 
                onClick={() => handleStop()}
                title="Stop generation"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                </svg>
              </button>
            </Show>
            <Show when={!isProcessing()}>
              <button 
                class="send-button" 
                onClick={() => handleSubmit()}
                disabled={!input().trim() || !isConnected()}
                title={!input().trim() ? "Voice input (not supported)" : "Send message"}
                style={!input().trim() ? "background: transparent; box-shadow: none; color: var(--text-secondary);" : ""}
              >
                <Show when={!input().trim()}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="22"></line>
                  </svg>
                </Show>
                <Show when={input().trim()}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </Show>
              </button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
