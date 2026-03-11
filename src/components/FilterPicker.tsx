"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface FilterOption {
  id: string;
  name: string;
  owner?: string;
  favourite: boolean;
}

export function FilterPicker({
  currentFilter,
  onFilterChange,
}: {
  currentFilter: string;
  onFilterChange: (filter: string) => void;
}) {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<FilterOption[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeName, setActiveName] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>(undefined);

  // Load initial favourites + resolve active filter name
  useEffect(() => {
    fetch("/api/filters")
      .then((r) => r.json())
      .then((data) => {
        setOptions(data.filters || []);
        if (currentFilter) {
          const match = (data.filters || []).find(
            (f: FilterOption) => f.id === currentFilter || f.name === currentFilter
          );
          setActiveName(match?.name || currentFilter);
        }
      })
      .catch(() => {});
  }, [currentFilter]);

  const search = useCallback((query: string) => {
    setLoading(true);
    fetch(`/api/filters?q=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then((data) => setOptions(data.filters || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleInputChange = (value: string) => {
    setInput(value);
    setShowDropdown(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      search(value);
    }, 250);
  };

  const handleSelect = (filter: FilterOption) => {
    setInput("");
    setActiveName(filter.name);
    setShowDropdown(false);
    onFilterChange(filter.id);
  };

  const handleClear = () => {
    setInput("");
    setActiveName("");
    setShowDropdown(false);
    onFilterChange("");
  };

  const handleFocus = () => {
    setShowDropdown(true);
    if (options.length === 0) search("");
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setShowDropdown(false);
    }
    if (e.key === "Enter" && input.trim()) {
      // Allow submitting a filter name directly
      setActiveName(input.trim());
      setShowDropdown(false);
      onFilterChange(input.trim());
      setInput("");
    }
  };

  return (
    <div className="mb-6" ref={containerRef}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            placeholder={activeName || "Search JIRA filters..."}
            className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent ${
              activeName && !input ? "placeholder:text-gray-900 placeholder:font-medium" : ""
            }`}
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
              ...
            </div>
          )}

          {/* Dropdown */}
          {showDropdown && options.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {options.map((f) => (
                <button
                  key={f.id}
                  onClick={() => handleSelect(f)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">{f.name}</div>
                    {f.owner && (
                      <div className="text-xs text-gray-500 truncate">{f.owner}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {f.favourite && (
                      <span className="text-xs text-yellow-600">*</span>
                    )}
                    <span className="text-xs text-gray-400">#{f.id}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {showDropdown && !loading && options.length === 0 && input && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm text-gray-500">
              No filters found. Press Enter to try &ldquo;{input}&rdquo; as a filter name.
            </div>
          )}
        </div>

        {activeName && (
          <button
            onClick={handleClear}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {activeName && (
        <p className="mt-2 text-xs text-gray-500">
          Showing projects from: <span className="font-medium text-gray-700">{activeName}</span>
        </p>
      )}
    </div>
  );
}
