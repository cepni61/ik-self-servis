import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { UserRef } from '../api/types';

/**
 * Kullanici secici. Sunucu tarafinda arama yapar (yalnizca aktif kullanicilar,
 * sinirli alanlar doner) ve secilen kullanicinin id'sini saklar.
 */
export function UserSearchInput({
  id,
  selectedId,
  onSelect,
  disabled,
  roleCode,
  placeholder = 'İsim veya e-posta ile arayın…',
}: {
  id?: string;
  selectedId: string | null;
  onSelect: (user: UserRef | null) => void;
  disabled?: boolean;
  roleCode?: string;
  placeholder?: string;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<UserRef[]>([]);
  const [selected, setSelected] = useState<UserRef | null>(null);
  const [open, setOpen] = useState(false);

  // Secili kullanicinin adini goster (id ile geldiyse)
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    if (selected?.id === selectedId) return;
    let cancelled = false;
    void (async () => {
      try {
        const user = await api.get<UserRef>(`/catalog/users/${selectedId}`);
        if (!cancelled) setSelected(user);
      } catch {
        // Kullanici bulunamadi/erisilemedi: secim temizlenir, kullanici yeniden secer.
        if (!cancelled) setSelected(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, selected?.id]);

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const query = new URLSearchParams({ q: term.trim() });
          if (roleCode) query.set('roleCode', roleCode);
          setResults(await api.get<UserRef[]>(`/catalog/users/search?${query}`));
        } catch {
          setResults([]);
        }
      })();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [term, roleCode]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded border border-ink-300 bg-white px-2.5 py-1.5">
        <span className="text-[13px] text-ink-900">
          {selected.displayName}
          {selected.title && <span className="text-ink-500"> · {selected.title}</span>}
        </span>
        {!disabled && (
          <button
            type="button"
            className="text-[12px] text-ink-500 hover:text-red-600"
            onClick={() => {
              setSelected(null);
              setTerm('');
              onSelect(null);
            }}
          >
            Kaldır
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        className="input"
        disabled={disabled}
        placeholder={placeholder}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-ink-300 bg-white shadow-lg">
          {results.map((user) => (
            <button
              key={user.id}
              type="button"
              className="block w-full border-b border-ink-100 px-2.5 py-1.5 text-left hover:bg-ink-50"
              onClick={() => {
                setSelected(user);
                setOpen(false);
                onSelect(user);
              }}
            >
              <div className="text-[13px] text-ink-900">{user.displayName}</div>
              <div className="text-[11px] text-ink-500">
                {[user.title, user.department].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
