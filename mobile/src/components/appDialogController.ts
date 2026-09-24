export type AppDialogAction = {
  label: string;
  role?: 'default' | 'destructive' | 'cancel';
  onPress?: () => void | Promise<void>;
};

export type AppDialog = {
  title: string;
  message?: string;
  actions: AppDialogAction[];
};

type Listener = (dialog: AppDialog | undefined) => void;

export type AppDialogController = ReturnType<typeof createAppDialogController>;

export function createAppDialogController() {
  let dialog: AppDialog | undefined;
  const listeners = new Set<Listener>();
  const publish = () => listeners.forEach((listener) => listener(dialog));

  return {
    current: () => dialog,
    subscribe: (listener: Listener) => {
      listener(dialog);
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    show: (next: AppDialog) => {
      dialog = next;
      publish();
    },
    dismiss: () => {
      if (!dialog) return;
      dialog = undefined;
      publish();
    },
    choose: (index: number) => {
      const action = dialog?.actions[index];
      if (!action) return;
      dialog = undefined;
      publish();
      void action.onPress?.();
    },
  };
}
