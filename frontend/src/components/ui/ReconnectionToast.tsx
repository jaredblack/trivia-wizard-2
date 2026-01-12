import { X } from "lucide-react";

interface ReconnectionToastProps {
  onCancel?: () => void;
}

export default function ReconnectionToast({ onCancel }: ReconnectionToastProps) {
  return (
    <div className="fixed top-4 left-4 right-4 z-50 flex justify-center">
      <div className="bg-amber-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-md">
        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
        <span className="flex-1">Reconnecting...</span>
        {onCancel && (
          <button
            onClick={onCancel}
            className="p-1 hover:bg-amber-600 rounded transition-colors"
          >
            <X size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
