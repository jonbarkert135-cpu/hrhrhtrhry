import privacy from '../../../../../docs/legal/privacy.md?raw';
import terms from '../../../../../docs/legal/terms.md?raw';
import rules from '../../../../../docs/legal/data-rules.md?raw';
import security from '../../../../../docs/legal/security.md?raw';
import copyright from '../../../../../docs/legal/copyright.md?raw';
import credits from '../../../../../docs/legal/credits.md?raw';

export const legalDocuments = {
  privacy: { title: 'Какие данные использует Raven', text: privacy },
  terms: { title: 'Условия использования', text: terms },
  'data-rules': { title: 'Правила данных', text: rules },
  security: { title: 'Безопасность', text: security },
  copyright: { title: 'Авторские права', text: copyright },
  credits: { title: 'Лицензии и материалы', text: credits },
};
export function legalDocument(id: string) {
  return Object.hasOwn(legalDocuments, id)
    ? legalDocuments[id as keyof typeof legalDocuments]
    : undefined;
}
