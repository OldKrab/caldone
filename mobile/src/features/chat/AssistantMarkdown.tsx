import { Fragment, type ReactNode } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { color, radius, space, type } from '../../design/tokens';

type Block =
  | { kind: 'paragraph' | 'quote'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string };

export function AssistantMarkdown(props: { children: string }) {
  return (
    <View>
      {parseBlocks(props.children).map((block, index) => (
        <Fragment key={`${block.kind}-${index}`}>
          {block.kind === 'heading' && <Text selectable style={[styles.body, styles.heading, block.level === 1 && styles.headingLarge]}>{inline(block.text)}</Text>}
          {block.kind === 'paragraph' && <Text selectable style={[styles.body, styles.paragraph]}>{inline(block.text)}</Text>}
          {block.kind === 'quote' && <View style={styles.quote}><Text selectable style={[styles.body, styles.quoteText]}>{inline(block.text)}</Text></View>}
          {block.kind === 'list' && <View style={styles.list}>{block.items.map((item, itemIndex) => <View key={`${itemIndex}-${item}`} style={styles.listRow}><Text style={styles.marker}>{block.ordered ? `${itemIndex + 1}.` : '•'}</Text><Text selectable style={[styles.body, styles.listText]}>{inline(item)}</Text></View>)}</View>}
          {block.kind === 'code' && <ScrollView horizontal style={styles.codeBlock}><Text selectable style={styles.codeBlockText}>{block.text}</Text></ScrollView>}
        </Fragment>
      ))}
    </View>
  );
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let code: string[] | undefined;
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flushParagraph();
      if (code) { blocks.push({ kind: 'code', text: code.join('\n') }); code = undefined; }
      else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const quote = /^\s*>\s?(.+)$/.exec(line);
    if (!line.trim()) { flushParagraph(); continue; }
    if (heading) { flushParagraph(); blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] }); continue; }
    if (quote) { flushParagraph(); blocks.push({ kind: 'quote', text: quote[1] }); continue; }
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      const text = (ordered ?? bullet)?.[1] ?? '';
      const previous = blocks.at(-1);
      if (previous?.kind === 'list' && previous.ordered === isOrdered) previous.items.push(text);
      else blocks.push({ kind: 'list', ordered: isOrdered, items: [text] });
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  if (code) blocks.push({ kind: 'code', text: code.join('\n') });
  return blocks;
}

function inline(source: string): ReactNode[] {
  const pattern = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  const result: ReactNode[] = [];
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) result.push(source.slice(offset, index));
    const token = match[0];
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
    if (link) result.push(<Text accessibilityRole="link" key={`${index}-link`} onPress={() => void Linking.openURL(link[2]).catch(() => undefined)} style={styles.link}>{link[1]}</Text>);
    else if (token.startsWith('**') || token.startsWith('__')) result.push(<Text key={`${index}-strong`} style={styles.strong}>{token.slice(2, -2)}</Text>);
    else if (token.startsWith('`')) result.push(<Text key={`${index}-code`} style={styles.inlineCode}>{token.slice(1, -1)}</Text>);
    else result.push(<Text key={`${index}-em`} style={styles.emphasis}>{token.slice(1, -1)}</Text>);
    offset = index + token.length;
  }
  if (offset < source.length) result.push(source.slice(offset));
  return result;
}

const styles = StyleSheet.create({
  body: { color: color.ink, fontSize: 16, lineHeight: 24 },
  paragraph: { marginBottom: 10 },
  heading: { fontFamily: type.ticketBold, fontSize: 20, lineHeight: 24, marginBottom: space.sm, marginTop: space.xs },
  headingLarge: { fontSize: 24, lineHeight: 28 },
  strong: { fontWeight: '700' },
  emphasis: { fontStyle: 'italic' },
  link: { color: color.action, textDecorationLine: 'underline' },
  inlineCode: { backgroundColor: color.surfacePressed, fontFamily: 'monospace', fontSize: 14 },
  list: { gap: space.xs, marginBottom: 10 },
  listRow: { alignItems: 'flex-start', flexDirection: 'row' },
  marker: { color: color.muted, fontSize: 16, lineHeight: 24, textAlign: 'right', width: 25 },
  listText: { flex: 1, marginLeft: space.sm },
  quote: { borderLeftColor: color.line, borderLeftWidth: StyleSheet.hairlineWidth, marginBottom: 10, paddingLeft: space.sm },
  quoteText: { color: color.muted },
  codeBlock: { backgroundColor: color.surfacePressed, borderRadius: radius.control, marginBottom: 10, maxWidth: '100%', padding: space.sm },
  codeBlockText: { color: color.ink, fontFamily: 'monospace', fontSize: 13, lineHeight: 19 },
});
