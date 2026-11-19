/**
 * Minimal typed subset of LINE message objects used by ShikSheek.
 * Spec: https://developers.line.biz/en/reference/messaging-api/#message-objects
 */

export interface PostbackAction {
  type: 'postback';
  label?: string;
  data: string; // max 300 chars
  displayText?: string;
  inputOption?: 'closeRichMenu' | 'openRichMenu' | 'openKeyboard' | 'openVoice';
  fillInText?: string;
}
export interface MessageAction {
  type: 'message';
  label?: string;
  text: string;
}
export interface UriAction {
  type: 'uri';
  label?: string;
  uri: string;
}
export interface DatetimePickerAction {
  type: 'datetimepicker';
  label?: string;
  data: string;
  mode: 'date' | 'time' | 'datetime';
  initial?: string;
  max?: string;
  min?: string;
}
/** Quick-reply only: open the camera / photo picker (the photo arrives as an image message). */
export interface CameraAction {
  type: 'camera' | 'cameraRoll';
  label: string;
}

export type Action = PostbackAction | MessageAction | UriAction | DatetimePickerAction | CameraAction;

export interface QuickReplyItem {
  type: 'action';
  imageUrl?: string;
  action: Action;
}
export interface QuickReply {
  items: QuickReplyItem[]; // max 13
}

export interface Sender {
  name?: string;
  iconUrl?: string;
}

export interface TextMessage {
  type: 'text';
  text: string; // max 5000
  quickReply?: QuickReply;
  sender?: Sender;
}

export interface FlexMessage {
  type: 'flex';
  altText: string; // max 1500
  contents: FlexContainer;
  quickReply?: QuickReply;
  sender?: Sender;
}

export interface StickerMessage {
  type: 'sticker';
  packageId: string;
  stickerId: string;
  quickReply?: QuickReply;
}

export type Message = TextMessage | FlexMessage | StickerMessage;

// Flex types are intentionally loose (component trees are large); templates are validated
// structurally in tests and against LINE's /message/validate endpoints by script.
export type FlexComponent = { type: string; [key: string]: unknown };
export interface FlexBubble {
  type: 'bubble';
  size?: 'nano' | 'micro' | 'deca' | 'hecto' | 'kilo' | 'mega' | 'giga';
  header?: FlexComponent;
  hero?: FlexComponent;
  body?: FlexComponent;
  footer?: FlexComponent;
  styles?: Record<string, unknown>;
  action?: Action;
}
export interface FlexCarousel {
  type: 'carousel';
  contents: FlexBubble[]; // max 12
}
export type FlexContainer = FlexBubble | FlexCarousel;

export const MAX_MESSAGES_PER_REPLY = 5;
export const MAX_QUICK_REPLY_ITEMS = 13;

export function text(t: string, quickReply?: QuickReply): TextMessage {
  const msg: TextMessage = { type: 'text', text: t.length > 5000 ? `${t.slice(0, 4997)}...` : t };
  if (quickReply) msg.quickReply = quickReply;
  return msg;
}

export function quickReply(actions: Action[]): QuickReply {
  // quick-reply labels max 20 chars (by code point, so emoji are never split)
  return {
    items: actions.slice(0, MAX_QUICK_REPLY_ITEMS).map((action) => ({
      type: 'action',
      action: 'label' in action && typeof action.label === 'string' && Array.from(action.label).length > 20 ? { ...action, label: Array.from(action.label).slice(0, 20).join('').trimEnd() } : action,
    })),
  };
}
