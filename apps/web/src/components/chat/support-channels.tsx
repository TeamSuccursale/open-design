/**
 * 「联系支持」弹窗里的渠道。
 *
 * `SupportDialog` 本身不硬编任何社群地址(渠道由调用方给),所以「产品在用的是哪几条」
 * 得有一个单一出处 —— 否则报错卡、帮助菜单、设置各写一份,改链接要改三处。
 *
 * MelilloDesign: the team reports problems to its developer on the fork, as the team guide
 * says, so the dialog carries that one row instead of the upstream Feishu group and Discord.
 */
import type { SupportChannel } from './SupportDialog';
import { Icon } from '../Icon';
import type { Dict } from '../../i18n/types';

export const TEAM_REPORT_URL = 'https://github.com/TeamSuccursale/open-design/issues/new';

export function supportChannels(
  t: (key: keyof Dict) => string,
): SupportChannel[] {
  return [
    {
      id: 'developer',
      name: t('chat.support.channel.developer'),
      href: TEAM_REPORT_URL,
      icon: <Icon name="github-filled" size={18} />,
      actionLabel: t('chat.support.openReport'),
    },
  ];
}
