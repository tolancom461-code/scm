import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const html = readFileSync(
  new URL("../../../public/gantt-studio/index.html", import.meta.url),
  "utf8"
);
const script = html.split("<script>")[1].split("</script>")[0];
const uiStart = script.indexOf("/* Gantt Studio 2.4 — shared data");
const engine = script.slice(0, uiStart);

function sourceBetween(start: string, end: string) {
  return script.slice(script.indexOf(start), script.indexOf(end));
}

class ElementStub {
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: ElementStub[] = [];
  value = "";

  set innerHTML(_value: string) {
    throw Error("The calendar row must use element properties");
  }

  append(...children: ElementStub[]) {
    this.children.push(...children);
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
}

describe("embedded Gantt Studio", () => {
  it("assigns a localized holiday name as a literal input value", () => {
    const rows = new ElementStub();
    const context = vm.createContext({
      document: { createElement: () => new ElementStub() },
      clone: (value: unknown) => JSON.parse(JSON.stringify(value)),
      $: () => rows,
    });
    vm.runInContext(engine, context);
    vm.runInContext(
      "const I = GanttI18n; I.setLanguage('ur',false); " +
        sourceBetween("  function holidayRow(", "  function openCalendar("),
      context
    );
    const name = 'دکان "A" & Unit <2>';
    context.holiday = {
      date: "2026-11-11",
      name: "Holiday",
      translations: { ur: { name } },
    };
    vm.runInContext("holidayRow(holiday);", context);
    expect(rows.children[0].children).toHaveLength(3);
    expect(rows.children[0].children[1].value).toBe(name);
    expect(rows.children[0].children[1].dataset.baseValue).toBe(name);
    expect(vm.runInContext("I.locale()", context)).toBe(
      "ur-PK-u-ca-gregory-nu-latn"
    );
  });

  it("retains edits made after submission while applying accepted task versions", () => {
    const context = vm.createContext({ I: { t: (value: string) => value } });
    vm.runInContext(
      sourceBetween("  function mergeSavedFields(", "  let deferredReceipt"),
      context
    );
    const base = {
      project: { name: "Phase one" },
      calendar: {},
      tasks: [
        { id: "draft", parentId: null, name: "First", start: "2026-11-10" },
        { id: "T22", parentId: "draft", name: "Second", pmVersion: 2 },
      ],
      links: [{ id: "draft-link", from: "draft", to: "T22" }],
    };
    context.before = base;
    context.accepted = {
      ...base,
      tasks: [
        {
          ...base.tasks[0],
          id: "T31",
          start: "2026-11-11",
          pmTaskId: 31,
          pmVersion: 1,
        },
        { ...base.tasks[1], parentId: "T31", pmTaskId: 22, pmVersion: 3 },
      ],
      links: [{ id: "L42", from: "T31", to: "T22", pmLinkId: 42 }],
    };
    context.local = {
      ...base,
      tasks: [
        { ...base.tasks[0], name: "Newer name" },
        base.tasks[1],
        { id: "new-child", parentId: "draft", name: "Created during save" },
      ],
    };
    const result = vm.runInContext(
      "rebaseStudioSave(before,accepted)(local)",
      context
    );
    expect(result.tasks).toMatchObject([
      {
        id: "draft",
        name: "Newer name",
        start: "2026-11-11",
        pmTaskId: 31,
        pmVersion: 1,
      },
      { id: "T22", parentId: "draft", pmVersion: 3 },
      { id: "new-child", parentId: "draft", name: "Created during save" },
    ]);
    expect(result.links).toEqual([
      { id: "draft-link", from: "draft", to: "T22", pmLinkId: 42 },
    ]);
  });

  it("loads project-unit field lengths and keeps the standalone engine checks green", () => {
    const context = vm.createContext({});
    new vm.Script(script);
    vm.runInContext(engine, context);
    const result = vm.runInContext(
      `const project=GanttEngine.demoProject();
       project.project.name='N'.repeat(255);
       project.project.description='D'.repeat(10000);
       project.tasks[0].name='T'.repeat(255);
       GanttEngine.validate(project);
       GanttSelfTests.run();`,
      context
    );
    expect(result.results.filter((item: { ok: boolean }) => !item.ok)).toEqual(
      []
    );
  });
});
