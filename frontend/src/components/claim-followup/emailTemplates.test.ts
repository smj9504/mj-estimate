import { describe, expect, it } from 'vitest';
import {
  fillTemplate, findPlaceholders, isBlankHtml, templateTypesForTask, toEditorHtml,
} from './emailTemplates';

describe('fillTemplate', () => {
  const values = { claim_number: '48-K211', property_address: '12 Oak & Elm St', adjuster_name: '' };

  it('fills the placeholders that have a value', () => {
    expect(fillTemplate('Claim {{claim_number}}', values)).toBe('Claim 48-K211');
  });

  it('leaves placeholders without a value as written', () => {
    expect(fillTemplate('Hi {{adjuster_name}}, {{invoice_amount}} due', values))
      .toBe('Hi {{adjuster_name}}, {{invoice_amount}} due');
  });

  it('escapes values for an HTML body but not for a subject', () => {
    expect(fillTemplate('<p>{{property_address}}</p>', values, { html: true }))
      .toBe('<p>12 Oak &amp; Elm St</p>');
    expect(fillTemplate('{{property_address}}', values)).toBe('12 Oak & Elm St');
  });

  it('ignores spaced braces, matching the backend renderer', () => {
    expect(fillTemplate('{{ claim_number }}', values)).toBe('{{ claim_number }}');
  });
});

describe('findPlaceholders', () => {
  it('lists each placeholder once across subject and body', () => {
    expect(findPlaceholders('{{a}} and {{b}}', '<p>{{a}} {{c}}</p>', undefined)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for filled text', () => {
    expect(findPlaceholders('Claim 48-K211')).toEqual([]);
  });
});

describe('toEditorHtml', () => {
  it('keeps HTML bodies as they are', () => {
    expect(toEditorHtml('<p>Hi</p>')).toBe('<p>Hi</p>');
  });

  it('turns plain text into paragraphs and line breaks', () => {
    expect(toEditorHtml('Hi Dana,\n\nThanks\nMJ')).toBe('<p>Hi Dana,</p><p>Thanks<br>MJ</p>');
  });
});

describe('isBlankHtml', () => {
  it('treats empty editor markup as blank', () => {
    expect(isBlankHtml('<p><br></p>')).toBe(true);
    expect(isBlankHtml('<p>&nbsp;</p>')).toBe(true);
    expect(isBlankHtml('<p>Hello</p>')).toBe(false);
  });
});

describe('templateTypesForTask', () => {
  it('suggests payment templates for payment tasks', () => {
    expect(templateTypesForTask('wm_payment_check')).toEqual(['payment_inquiry']);
  });

  it('suggests nothing for unknown or missing task types', () => {
    expect(templateTypesForTask('general')).toEqual([]);
    expect(templateTypesForTask(undefined)).toEqual([]);
  });
});
