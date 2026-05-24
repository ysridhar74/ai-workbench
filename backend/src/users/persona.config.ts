import { PersonaType } from '../db/schemas/user.schema';

export interface QuickAction {
  label: string;
  prompt: string;
  icon: string;
}

export interface PersonaConfig {
  persona: PersonaType;
  displayName: string;
  description: string;
  color: string;               // hex accent used in frontend badge
  skill: string;               // default skill name
  ragNamespace: string;        // default RAG namespace
  defaultDatabase: string;     // default mongo-query database name
  quickActions: QuickAction[];
}

export const PERSONA_CONFIG: Record<PersonaType, PersonaConfig> = {
  broker: {
    persona: 'broker',
    displayName: 'Placement Broker',
    description: 'Cedant relationships, capacity placement, slip drafting',
    color: '#185FA5',
    skill: 'broker-assistant',
    ragNamespace: 'broker',
    defaultDatabase: 'crm',
    quickActions: [
      {
        label: 'Summarise cedant',
        prompt: 'Give me a summary of this cedant including their key treaties, renewal dates, and any recent changes.',
        icon: '🏢',
      },
      {
        label: 'Check capacity',
        prompt: 'What reinsurance capacity do we currently have available for property cat placements?',
        icon: '📊',
      },
      {
        label: 'Draft slip',
        prompt: 'Draft a reinsurance slip for a property catastrophe XL treaty. Ask me for the key terms.',
        icon: '📝',
      },
      {
        label: 'Renewal pipeline',
        prompt: 'Show me the upcoming treaty renewals for the next 90 days.',
        icon: '🔄',
      },
      {
        label: 'Market conditions',
        prompt: 'What are the current market conditions for property reinsurance? Summarise rate movements and capacity trends.',
        icon: '📈',
      },
    ],
  },

  underwriter: {
    persona: 'underwriter',
    displayName: 'Underwriter',
    description: 'Risk analysis, submissions, pricing, exposure assessment',
    color: '#0F6E56',
    skill: 'underwriter-assistant',
    ragNamespace: 'underwriter',
    defaultDatabase: 'erp',
    quickActions: [
      {
        label: 'Review submission',
        prompt: 'Help me review this reinsurance submission. What key risk factors should I assess?',
        icon: '🔍',
      },
      {
        label: 'Exposure analysis',
        prompt: 'Run an exposure analysis for the current treaty portfolio. Show me concentration by geography and peril.',
        icon: '🗺️',
      },
      {
        label: 'Pricing check',
        prompt: 'What is the technical pricing for a property cat XL layer? Walk me through the key assumptions.',
        icon: '💰',
      },
      {
        label: 'Loss history',
        prompt: 'Show me the 10-year loss history for this cedant including attritional and large losses.',
        icon: '📉',
      },
      {
        label: 'Treaty comparison',
        prompt: 'Compare the terms and conditions of the top 5 treaties in the current portfolio.',
        icon: '⚖️',
      },
    ],
  },

  claims: {
    persona: 'claims',
    displayName: 'Claims Analyst',
    description: 'Loss tracking, reserves, recoveries, loss development',
    color: '#854F0B',
    skill: 'claims-assistant',
    ragNamespace: 'claims',
    defaultDatabase: 'erp',
    quickActions: [
      {
        label: 'Loss run summary',
        prompt: 'Provide a loss run summary for the current year including paid, outstanding, and IBNR by line of business.',
        icon: '📋',
      },
      {
        label: 'Reserve movement',
        prompt: 'Show me the reserve movement analysis for the last quarter. Highlight any significant developments.',
        icon: '📊',
      },
      {
        label: 'Recovery status',
        prompt: 'What is the current status of our reinsurance recoveries? Show outstanding recoveries by cedant.',
        icon: '💵',
      },
      {
        label: 'Large loss report',
        prompt: 'List all large losses above $1M reported in the last 6 months with current reserve and recovery status.',
        icon: '⚠️',
      },
      {
        label: 'Loss development',
        prompt: 'Show the loss development triangles for property and casualty lines. Identify any adverse development.',
        icon: '📐',
      },
    ],
  },
};
