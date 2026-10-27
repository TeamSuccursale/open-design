import { describe, expect, it } from 'vitest';

import {
  assertCanonicalXmlText,
  type CanonicalXmlNode,
  indexCanonicalXmlChildren,
  parseCanonicalXml,
  requireCanonicalXmlElement,
  serializeCanonicalXml,
  withoutXmlForbiddenCharacters,
} from '../src/prompts/canonical-xml.js';

const tree: CanonicalXmlNode = {
  kind: 'element',
  tag: 'root',
  attributes: [['schema', 'demo/v1']],
  children: [
    {
      kind: 'element',
      tag: 'branch',
      children: [
        { kind: 'text', tag: 'leaf', attributes: [['name', 'a']], text: '# Title\n\nbody' },
        { kind: 'marker', tag: 'marked', attributes: [['name', 'file-write']] },
      ],
    },
    { kind: 'text', tag: 'tail', text: '' },
  ],
};

describe('canonical XML tree', () => {
  it('serializes one deterministic encoding with nested depth', () => {
    const xml = serializeCanonicalXml(tree);
    expect(xml).toBe(
      [
        '<root schema="demo/v1">',
        '  <branch>',
        '    <leaf name="a">',
        '      <![CDATA[# Title',
        '',
        'body]]>',
        '    </leaf>',
        '    <marked name="file-write" />',
        '  </branch>',
        '  <tail>',
        '    <![CDATA[]]>',
        '  </tail>',
        '</root>',
      ].join('\n'),
    );
    expect(serializeCanonicalXml(tree)).toBe(xml);
    expect(parseCanonicalXml(xml)).toEqual(tree);
  });

  it('round-trips hostile text without letting it close a node', () => {
    const hostile = 'a]]>b</leaf></root><second/>\r\nc & <d attr="e">';
    const xml = serializeCanonicalXml({
      kind: 'element',
      tag: 'root',
      children: [{ kind: 'text', tag: 'leaf', text: hostile }],
    });
    expect(xml).toContain(']]]]><![CDATA[>');
    const parsed = requireCanonicalXmlElement(parseCanonicalXml(xml), 'root');
    expect(parsed.children).toEqual([
      { kind: 'text', tag: 'leaf', text: hostile.replace('\r\n', '\n') },
    ]);
  });

  it('escapes and restores attribute values', () => {
    const value = 'a & b < c > d " e \' f';
    const xml = serializeCanonicalXml({
      kind: 'marker',
      tag: 'leaf',
      attributes: [['name', value]],
    });
    expect(xml).toBe('<leaf name="a &amp; b &lt; c &gt; d &quot; e &apos; f" />');
    expect(parseCanonicalXml(xml)).toEqual({
      kind: 'marker',
      tag: 'leaf',
      attributes: [['name', value]],
    });
  });

  it('rejects non-canonical bytes, drifted indent, extra roots, and duplicate tags', () => {
    const xml = serializeCanonicalXml(tree);
    expect(() => parseCanonicalXml(' ' + xml)).toThrow(/Non-canonical XML/);
    expect(() => parseCanonicalXml(xml + '\n')).toThrow(/bytes outside its root/);
    expect(() => parseCanonicalXml(xml + '<other/>')).toThrow(/bytes outside its root/);
    expect(() => parseCanonicalXml(xml.replace('  <branch>', '   <branch>')))
      .toThrow(/Non-canonical XML/);
    expect(() => parseCanonicalXml(xml.replace('<tail>', '<TAIL>')))
      .toThrow(/lowercase snake_case/);
    expect(() => serializeCanonicalXml({
      kind: 'element',
      tag: 'root',
      children: [
        { kind: 'text', tag: 'leaf', text: 'a' },
        { kind: 'text', tag: 'leaf', text: 'b' },
      ],
    })).toThrow(/repeats child leaf/);
    expect(() => serializeCanonicalXml({ kind: 'element', tag: 'root', children: [] }))
      .toThrow(/use a marker node instead/);
    expect(() => serializeCanonicalXml({ kind: 'text', tag: 'leaf', text: '\u0000' }))
      .toThrow(/XML 1\.0/);
    expect(() => serializeCanonicalXml({
      kind: 'marker',
      tag: 'leaf',
      attributes: [['name', 'a\nb']],
    })).toThrow(/must not contain a newline/);
  });

  it('indexes children by tag and enforces the declared slot order', () => {
    const root = requireCanonicalXmlElement(parseCanonicalXml(serializeCanonicalXml(tree)), 'root');
    const index = indexCanonicalXmlChildren(root, ['branch', 'tail'], 'root');
    expect([...index.keys()]).toEqual(['branch', 'tail']);
    expect(() => indexCanonicalXmlChildren(root, ['tail', 'branch'], 'root'))
      .toThrow(/out of canonical order/);
    expect(() => indexCanonicalXmlChildren(root, ['branch'], 'root'))
      .toThrow(/unexpected child: tail/);
  });
});

describe('canonical XML keyed sibling lists', () => {
  it('allows siblings that share a tag but differ by attribute', () => {
    const keyed: CanonicalXmlNode = {
      kind: 'element',
      tag: 'stages',
      children: [
        {
          kind: 'element',
          tag: 'stage',
          attributes: [['name', 'plan']],
          children: [
            { kind: 'text', tag: 'atom', attributes: [['name', 'direction-picker']], text: 'a' },
            { kind: 'marker', tag: 'atom', attributes: [['name', 'todo-write']] },
          ],
        },
        {
          kind: 'element',
          tag: 'stage',
          attributes: [['name', 'generate']],
          children: [{ kind: 'marker', tag: 'atom', attributes: [['name', 'file-write']] }],
        },
      ],
    };
    const xml = serializeCanonicalXml(keyed);
    expect(xml).toBe(
      [
        '<stages>',
        '  <stage name="plan">',
        '    <atom name="direction-picker">',
        '      <![CDATA[a]]>',
        '    </atom>',
        '    <atom name="todo-write" />',
        '  </stage>',
        '  <stage name="generate">',
        '    <atom name="file-write" />',
        '  </stage>',
        '</stages>',
      ].join('\n'),
    );
    expect(parseCanonicalXml(xml)).toEqual(keyed);
  });

  it('still rejects two siblings with an identical tag and attribute list', () => {
    expect(() => serializeCanonicalXml({
      kind: 'element',
      tag: 'stages',
      children: [
        { kind: 'marker', tag: 'atom', attributes: [['name', 'todo-write']] },
        { kind: 'marker', tag: 'atom', attributes: [['name', 'todo-write']] },
      ],
    })).toThrow(/repeats child atom\[name=todo-write\]/);
  });
});

describe('withoutXmlForbiddenCharacters', () => {
  // A tender PDF read on 27 Oct 2026 gave "DELL'OF\uFFFEFERTA"; that one character made every OD Next run of the project fall back.
  it('drops what XML 1.0 forbids from source text and keeps the words readable', () => {
    expect(withoutXmlForbiddenCharacters('DELL\u2019OF\uFFFEFERTA')).toBe('DELL\u2019OFFERTA');
    expect(withoutXmlForbiddenCharacters('pagina 1\fpagina 2\u0002')).toBe('pagina 1 pagina 2 ');
    expect(withoutXmlForbiddenCharacters('lone \uD800 surrogate')).toBe('lone \uFFFD surrogate');
    const cleaned = withoutXmlForbiddenCharacters('a\u0000b\uFFFFc\t\r\nd \u{1F600}');
    expect(cleaned).toBe('a bc\t\r\nd \u{1F600}');
    expect(() => assertCanonicalXmlText(cleaned, 'text')).not.toThrow();
  });
});
