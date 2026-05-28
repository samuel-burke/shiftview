import { Employee, Schedule, fmtMinutes } from "../data/types";

type Props = {
  employees: Employee[];
  schedules: Schedule[];
  weekDates: string[];
  weekLabel: string;
};

export default function PrintableWeekGrid({ employees, schedules, weekDates, weekLabel }: Props) {
  const DAY_LABELS = weekDates.map(d => {
    const dt = new Date(d + "T12:00:00Z");
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });
  });

  return (
    <div className="hidden print:block p-8 font-sans text-black bg-white">
      <h1 className="text-2xl font-bold mb-1">ShiftView</h1>
      <p className="text-sm text-gray-500 mb-6">{weekLabel}</p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-gray-300 p-2 text-left bg-gray-50">Employee</th>
            {DAY_LABELS.map(d => (
              <th key={d} className="border border-gray-300 p-2 text-center bg-gray-50">{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map(emp => (
            <tr key={emp.id}>
              <td className="border border-gray-300 p-2 font-medium">{emp.name}</td>
              {weekDates.map(date => {
                const sch = schedules.find(s => s.employeeId === emp.id && s.date === date);
                return (
                  <td key={date} className="border border-gray-300 p-2 text-center text-gray-600">
                    {sch ? `${fmtMinutes(sch.startMinutes)} – ${fmtMinutes(sch.endMinutes)}` : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
