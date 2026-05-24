import { useEffect, useState } from 'react';
import { usersApi } from '@/api/client';
import { useUserStore } from '@/store/userStore';
import type { User } from '@/types';

const PERSONA_BG: Record<string, string> = {
  broker: 'bg-blue-50 border-blue-200 hover:border-blue-400',
  underwriter: 'bg-emerald-50 border-emerald-200 hover:border-emerald-400',
  claims: 'bg-amber-50 border-amber-200 hover:border-amber-400',
};

const PERSONA_BADGE: Record<string, string> = {
  broker: 'bg-blue-100 text-blue-800',
  underwriter: 'bg-emerald-100 text-emerald-800',
  claims: 'bg-amber-100 text-amber-800',
};

const PERSONA_ICON: Record<string, string> = {
  broker: '🤝',
  underwriter: '🔍',
  claims: '📋',
};

export function UserSelector() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const setCurrentUser = useUserStore((s) => s.setCurrentUser);

  useEffect(() => {
    usersApi.list()
      .then(setUsers)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-8">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white border border-gray-200 mb-4 text-2xl shadow-sm">
            ⚡
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">AI Workbench</h1>
          <p className="text-gray-500 mt-1 text-sm">Select your profile to continue</p>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 text-sm py-12">Loading users…</div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {users.map((user) => (
              <button
                key={user.userId}
                onClick={() => setCurrentUser(user)}
                className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-150 bg-white ${PERSONA_BG[user.persona] ?? 'border-gray-200 hover:border-gray-400'}`}
              >
                <div className="flex items-center gap-4">
                  {/* Avatar */}
                  <div className="w-11 h-11 rounded-full bg-white border border-gray-200 flex items-center justify-center text-xl flex-shrink-0 shadow-sm">
                    {PERSONA_ICON[user.persona] ?? '👤'}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900">{user.name}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PERSONA_BADGE[user.persona] ?? 'bg-gray-100 text-gray-700'}`}>
                        {user.personaConfig.displayName}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5 truncate">{user.personaConfig.description}</p>
                  </div>

                  {/* Arrow */}
                  <div className="text-gray-300 text-lg flex-shrink-0">→</div>
                </div>
              </button>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-8">
          Reinsurance AI Workbench · Internal use only
        </p>
      </div>
    </div>
  );
}
