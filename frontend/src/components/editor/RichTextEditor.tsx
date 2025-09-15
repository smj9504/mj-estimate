import React, { useRef, useEffect } from 'react';
import { Button, Space, Tooltip } from 'antd';
import {
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  OrderedListOutlined,
  UnorderedListOutlined,
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
} from '@ant-design/icons';
import './RichTextEditor.css';

interface RichTextEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value = '',
  onChange,
  placeholder = 'Enter text here...',
  minHeight = 200,
  maxHeight = 400,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);

  // Function to save cursor position
  const saveCursorPosition = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.anchorNode)) {
      return {
        start: selection.getRangeAt(0).startOffset,
        end: selection.getRangeAt(0).endOffset,
        anchorNode: selection.anchorNode,
      };
    }
    return null;
  };

  // Function to restore cursor position
  const restoreCursorPosition = (cursorData: any) => {
    if (cursorData && editorRef.current) {
      try {
        const selection = window.getSelection();
        const range = document.createRange();
        
        if (cursorData.anchorNode && editorRef.current.contains(cursorData.anchorNode)) {
          range.setStart(cursorData.anchorNode, Math.min(cursorData.start, cursorData.anchorNode.textContent?.length || 0));
          range.setEnd(cursorData.anchorNode, Math.min(cursorData.end, cursorData.anchorNode.textContent?.length || 0));
          
          selection?.removeAllRanges();
          selection?.addRange(range);
        } else {
          // Fallback: place cursor at the end
          range.selectNodeContents(editorRef.current);
          range.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      } catch (e) {
        // Ignore cursor restoration errors
      }
    }
  };

  // Initial setup
  useEffect(() => {
    if (editorRef.current && value && !editorRef.current.innerHTML) {
      editorRef.current.innerHTML = value;
    }
  }, []);

  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.innerHTML && !isInternalChange.current) {
      const cursorData = saveCursorPosition();
      editorRef.current.innerHTML = value;
      
      // Restore cursor position after a microtask
      setTimeout(() => {
        if (cursorData) {
          restoreCursorPosition(cursorData);
        }
      }, 0);
    }
    isInternalChange.current = false;
  }, [value]);

  const handleCommand = (command: string, value?: string) => {
    if (editorRef.current) {
      editorRef.current.focus();
      const cursorData = saveCursorPosition();
      document.execCommand(command, false, value);
      setTimeout(() => {
        handleChange();
        if (cursorData) {
          restoreCursorPosition(cursorData);
        }
      }, 0);
    }
  };

  const handleChange = () => {
    if (editorRef.current && onChange) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle keyboard shortcuts
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case 'b':
          e.preventDefault();
          handleCommand('bold');
          break;
        case 'i':
          e.preventDefault();
          handleCommand('italic');
          break;
        case 'u':
          e.preventDefault();
          handleCommand('underline');
          break;
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    handleChange();
  };

  return (
    <div className="rich-text-editor">
      <div className="editor-toolbar">
        <Space.Compact>
          <Tooltip title="Bold (Ctrl+B)">
            <Button
              icon={<BoldOutlined />}
              onClick={() => handleCommand('bold')}
              size="small"
            />
          </Tooltip>
          <Tooltip title="Italic (Ctrl+I)">
            <Button
              icon={<ItalicOutlined />}
              onClick={() => handleCommand('italic')}
              size="small"
            />
          </Tooltip>
          <Tooltip title="Underline (Ctrl+U)">
            <Button
              icon={<UnderlineOutlined />}
              onClick={() => handleCommand('underline')}
              size="small"
            />
          </Tooltip>
        </Space.Compact>

        <Space.Compact style={{ marginLeft: 8 }}>
          <Tooltip title="Ordered List">
            <Button
              icon={<OrderedListOutlined />}
              onClick={() => handleCommand('insertOrderedList')}
              size="small"
            />
          </Tooltip>
          <Tooltip title="Unordered List">
            <Button
              icon={<UnorderedListOutlined />}
              onClick={() => handleCommand('insertUnorderedList')}
              size="small"
            />
          </Tooltip>
        </Space.Compact>

        <Space.Compact style={{ marginLeft: 8 }}>
          <Tooltip title="Align Left">
            <Button
              icon={<AlignLeftOutlined />}
              onClick={() => handleCommand('justifyLeft')}
              size="small"
            />
          </Tooltip>
          <Tooltip title="Align Center">
            <Button
              icon={<AlignCenterOutlined />}
              onClick={() => handleCommand('justifyCenter')}
              size="small"
            />
          </Tooltip>
          <Tooltip title="Align Right">
            <Button
              icon={<AlignRightOutlined />}
              onClick={() => handleCommand('justifyRight')}
              size="small"
            />
          </Tooltip>
        </Space.Compact>
      </div>
      
      <div
        ref={editorRef}
        className="editor-content"
        contentEditable
        onInput={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        style={{
          minHeight: `${minHeight}px`,
          maxHeight: `${maxHeight}px`,
        }}
        suppressContentEditableWarning={true}
      />
    </div>
  );
};

export default RichTextEditor;