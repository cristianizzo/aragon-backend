/**
 * NatSpec parser for Solidity and Vyper source code.
 * Extracts @notice, @param, @return tags from contract source.
 * Ported from original app-backend contractNetspec.ts
 */

interface NatSpecTag {
  notice?: string;
  params: Record<string, string>;
  returnDesc?: string;
}

interface FunctionNatSpec {
  name: string;
  notice?: string;
  params: Record<string, string>;
}

export interface ParsedNatSpec {
  contractName?: string;
  functions: Record<string, FunctionNatSpec>;
}

/**
 * Parse NatSpec from source code (Solidity or Vyper).
 * Handles multi-file JSON format from Etherscan.
 */
export function parseNatSpec(sourceCode: string, contractName?: string): ParsedNatSpec {
  const result: ParsedNatSpec = { contractName, functions: {} };

  if (!sourceCode || sourceCode.trim().length === 0) return result;

  // Handle Etherscan multi-file JSON format
  const source = extractSourceCode(sourceCode);
  if (!source) return result;

  const lang = detectLanguage(source);
  if (lang === "solidity") {
    parseSolidityNatSpec(source, result);
  } else if (lang === "vyper") {
    parseVyperNatSpec(source, result);
  }

  return result;
}

function extractSourceCode(raw: string): string | null {
  // Etherscan sometimes wraps in extra braces: {{...}}
  let cleaned = raw.trim();
  if (cleaned.startsWith("{{") && cleaned.endsWith("}}")) {
    cleaned = cleaned.slice(1, -1);
  }

  // Try JSON multi-file format
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.sources) {
      // Concatenate all source files
      return Object.values(parsed.sources)
        .map((s: any) => s.content || "")
        .join("\n\n");
    }
    if (typeof parsed === "string") return parsed;
  } catch {
    // Not JSON, use as-is
  }

  return cleaned;
}

function detectLanguage(source: string): "solidity" | "vyper" | "unknown" {
  const lines = source.split("\n").slice(0, 200);
  let solidityScore = 0;
  let vyperScore = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("pragma solidity")) solidityScore += 10;
    if (trimmed.match(/^(contract|interface|library|abstract)\s/)) solidityScore += 5;
    if (trimmed.includes("function ") && trimmed.includes("{")) solidityScore += 2;
    if (trimmed.includes("mapping(")) solidityScore += 3;
    if (trimmed.endsWith(";")) solidityScore += 1;

    if (trimmed.startsWith("# @version") || trimmed.startsWith("@version")) vyperScore += 10;
    if (trimmed.startsWith("def ")) vyperScore += 5;
    if (trimmed.startsWith("@external") || trimmed.startsWith("@internal")) vyperScore += 5;
    if (trimmed.includes("self.")) vyperScore += 3;
  }

  if (solidityScore > vyperScore && solidityScore > 5) return "solidity";
  if (vyperScore > solidityScore && vyperScore > 5) return "vyper";
  return "unknown";
}

function parseSolidityNatSpec(source: string, result: ParsedNatSpec): void {
  const lines = source.split("\n");
  let currentComment: string[] = [];
  let inMultiLineComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Track multi-line comments /** ... */
    if (line.startsWith("/**")) {
      inMultiLineComment = true;
      currentComment = [];
      const content = line.replace("/**", "").replace("*/", "").trim();
      if (content) currentComment.push(content);
      if (line.includes("*/")) inMultiLineComment = false;
      continue;
    }

    if (inMultiLineComment) {
      if (line.includes("*/")) {
        const content = line
          .replace("*/", "")
          .replace(/^\*\s?/, "")
          .trim();
        if (content) currentComment.push(content);
        inMultiLineComment = false;
      } else {
        const content = line.replace(/^\*\s?/, "").trim();
        if (content) currentComment.push(content);
      }
      continue;
    }

    // Single-line /// comments
    if (line.startsWith("///")) {
      currentComment.push(line.replace("///", "").trim());
      continue;
    }

    // Function definition following a comment
    if (currentComment.length > 0 && line.startsWith("function ")) {
      const funcName = extractSolidityFunctionName(line);
      if (funcName) {
        const tags = parseNatSpecTags(currentComment);
        result.functions[funcName] = {
          name: funcName,
          notice: tags.notice,
          params: tags.params,
        };
      }
      currentComment = [];
      continue;
    }

    // Non-comment, non-function line resets comment
    if (!line.startsWith("//") && line.length > 0) {
      currentComment = [];
    }
  }
}

function parseVyperNatSpec(source: string, result: ParsedNatSpec): void {
  const lines = source.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!.trim();

    // Look for function definitions
    if (line.startsWith("def ")) {
      const funcName = line.match(/^def\s+(\w+)/)?.[1];
      if (funcName) {
        // Check for docstring after function def
        const docstring = extractVyperDocstring(lines, i + 1);
        if (docstring) {
          const tags = parseNatSpecTags(docstring);
          result.functions[funcName] = {
            name: funcName,
            notice: tags.notice,
            params: tags.params,
          };
        }
      }
    }

    // Also check ## comments before @external/@internal
    if ((line === "@external" || line === "@internal") && i + 1 < lines.length) {
      const nextLine = lines[i + 1]?.trim();
      if (nextLine?.startsWith("def ")) {
        // Check for ## comments before decorator
        const comments = collectVyperComments(lines, i);
        if (comments.length > 0) {
          const funcName = nextLine.match(/^def\s+(\w+)/)?.[1];
          if (funcName) {
            const tags = parseNatSpecTags(comments);
            result.functions[funcName] = {
              name: funcName,
              notice: tags.notice,
              params: tags.params,
            };
          }
        }
      }
    }

    i++;
  }
}

function extractVyperDocstring(lines: string[], startIdx: number): string[] | null {
  if (startIdx >= lines.length) return null;
  const firstLine = lines[startIdx]!.trim();
  if (!firstLine.startsWith('"""')) return null;

  const result: string[] = [];
  // Single-line docstring
  if (firstLine.endsWith('"""') && firstLine.length > 6) {
    result.push(firstLine.slice(3, -3).trim());
    return result;
  }

  // Multi-line docstring
  result.push(firstLine.slice(3).trim());
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.includes('"""')) {
      const content = line.replace('"""', "").trim();
      if (content) result.push(content);
      break;
    }
    result.push(line);
  }

  return result.filter((l) => l.length > 0);
}

function collectVyperComments(lines: string[], decoratorIdx: number): string[] {
  const comments: string[] = [];
  for (let i = decoratorIdx - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line.startsWith("##")) {
      comments.unshift(line.replace(/^##\s?/, "").trim());
    } else {
      break;
    }
  }
  return comments;
}

function extractSolidityFunctionName(line: string): string | null {
  const match = line.match(/function\s+(\w+)\s*\(/);
  return match?.[1] || null;
}

function parseNatSpecTags(lines: string[]): NatSpecTag {
  const result: NatSpecTag = { params: {} };
  let currentTag: string | null = null;
  let currentParamName: string | null = null;

  for (const line of lines) {
    if (line.startsWith("@notice")) {
      currentTag = "notice";
      currentParamName = null;
      const value = line.replace("@notice", "").trim();
      result.notice = value;
    } else if (line.startsWith("@param")) {
      currentTag = "param";
      const match = line.match(/@param\s+(\w+)\s+(.*)/);
      if (match?.[1] && match[2] !== undefined) {
        currentParamName = match[1];
        result.params[match[1]] = match[2].trim();
      }
    } else if (line.startsWith("@return")) {
      currentTag = "return";
      currentParamName = null;
      result.returnDesc = line.replace("@return", "").trim();
    } else if (line.startsWith("@")) {
      // Other tag, reset
      currentTag = null;
      currentParamName = null;
    } else if (currentTag === "notice" && !line.startsWith("@")) {
      // Continuation of notice
      result.notice = (result.notice || "") + " " + line;
    } else if (currentTag === "param" && currentParamName && !line.startsWith("@")) {
      // Continuation of param
      result.params[currentParamName] = (result.params[currentParamName] || "") + " " + line;
    } else if (!currentTag && !line.startsWith("@")) {
      // Default text before any tag = notice
      result.notice = result.notice ? result.notice + " " + line : line;
    }
  }

  return result;
}
