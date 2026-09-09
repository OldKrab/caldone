import { File, Paths } from 'expo-file-system';
import { MealRequestDiagnostics, type MealRequestTrace } from '../ai/mealRequestTrace';

// One private app-owned file, excluded from normal meal backups. The explicit
// diagnostics export includes it; deleting meal photos/data also clears it.
const file = () => new File(Paths.document, 'meal-request-trace.json');
export const mealRequestDiagnostics = new MealRequestDiagnostics({
  read() {
    const saved = file();
    return saved.exists ? JSON.parse(saved.textSync()) as MealRequestTrace : undefined;
  },
  write(value) {
    const saved = file();
    if (value) {
      if (!saved.exists) saved.create();
      saved.write(JSON.stringify(value));
    }
    else if (saved.exists) saved.delete();
  },
});
