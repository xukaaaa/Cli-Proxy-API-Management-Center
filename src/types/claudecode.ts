/**
 * Claude Code Integration (claudecode) 配置
 */

export interface ClaudeCodeModelMapping {
  from: string;
  to: string;
  regex?: boolean;
}

export interface ClaudeCodeConfig {
  modelMappings?: ClaudeCodeModelMapping[];
  forceModelMappings?: boolean;
}
