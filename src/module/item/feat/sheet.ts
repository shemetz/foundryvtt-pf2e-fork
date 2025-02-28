import {
    activateActionSheetListeners,
    createSelfEffectSheetData,
    handleSelfEffectDrop,
} from "@item/ability/helpers.ts";
import { SelfEffectReference } from "@item/ability/index.ts";
import { ARMOR_CATEGORIES } from "@item/armor/values.ts";
import { ItemSheetDataPF2e, ItemSheetOptions, ItemSheetPF2e } from "@item/base/sheet/sheet.ts";
import type { FeatPF2e } from "@item/feat/document.ts";
import { WEAPON_CATEGORIES } from "@item/weapon/values.ts";
import { OneToFour } from "@module/data.ts";
import { htmlClosest, htmlQuery, localizer, sluggify, tagify, tupleHasValue } from "@util";
import * as R from "remeda";
import { featCanHaveKeyOptions } from "./helpers.ts";

class FeatSheetPF2e extends ItemSheetPF2e<FeatPF2e> {
    static override get defaultOptions(): ItemSheetOptions {
        return {
            ...super.defaultOptions,
            dragDrop: [{ dropSelector: ".tab[data-tab=details]" }],
            hasSidebar: true,
        };
    }

    override get validTraits(): Record<string, string> {
        return CONFIG.PF2E.featTraits;
    }

    override async getData(options?: Partial<ItemSheetOptions>): Promise<FeatSheetData> {
        const sheetData = await super.getData(options);
        const feat = this.item;
        const hasLineageTrait = feat.system.traits.value.includes("lineage");

        return {
            ...sheetData,
            itemType: game.i18n.localize(feat.isFeature ? "PF2E.LevelLabel" : "PF2E.Item.Feat.LevelLabel"),
            actionsNumber: CONFIG.PF2E.actionsNumber,
            actionTypes: CONFIG.PF2E.actionTypes,
            attributes: CONFIG.PF2E.abilities,
            canHaveKeyOptions: featCanHaveKeyOptions(feat),
            categories: CONFIG.PF2E.featCategories,
            frequencies: CONFIG.PF2E.frequencies,
            hasLineageTrait,
            hasProficiencies: Object.keys(feat.system.subfeatures.proficiencies).length > 0,
            mandatoryTakeOnce: hasLineageTrait || sheetData.data.onlyLevel1,
            proficiencies: this.#createProficiencyOptions(),
            selfEffect: createSelfEffectSheetData(sheetData.data.selfEffect),
        };
    }

    #createProficiencyOptions(): ProficiencyOptions {
        const feat = this.item;
        const localize = localizer("PF2E.Actor.Character");
        const selectedIncreases = feat.system.subfeatures.proficiencies;

        return {
            other: {
                group: null,
                options: [
                    {
                        slug: "perception",
                        label: game.i18n.localize("PF2E.PerceptionLabel"),
                        rank: selectedIncreases.perception?.rank ?? null,
                    },
                    {
                        slug: "spellcasting",
                        label: game.i18n.localize("PF2E.Actor.Creature.Spellcasting.ShortLabel"),
                        rank: selectedIncreases.spellcasting?.rank ?? null,
                    },
                ].sort((a, b) => a.label.localeCompare(b.label)),
            },
            saves: {
                group: localize("Proficiency.SavingThrow.Title"),
                options: R.toPairs
                    .strict(CONFIG.PF2E.saves)
                    .map(([slug, label]) => ({
                        slug,
                        label: game.i18n.localize(label),
                        rank: selectedIncreases[slug]?.rank ?? null,
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label)),
            },
            attacks: {
                group: localize("Proficiency.Attack.Title"),
                options: R.toPairs
                    .strict(CONFIG.PF2E.weaponCategories)
                    .map(([slug, categoryLabel]) => {
                        const label = tupleHasValue(WEAPON_CATEGORIES, slug)
                            ? localize(`Proficiency.Attack.${sluggify(slug, { camel: "bactrian" })}`)
                            : game.i18n.localize(categoryLabel);
                        return {
                            slug,
                            label,
                            rank: selectedIncreases[slug]?.rank ?? null,
                        };
                    })
                    .sort((a, b) => a.label.localeCompare(b.label)),
            },
            defenses: {
                group: localize("Proficiency.Defense.Title"),
                options: R.toPairs
                    .strict(CONFIG.PF2E.armorCategories)
                    .map(([slug, categoryLabel]) => {
                        const label = tupleHasValue(ARMOR_CATEGORIES, slug)
                            ? localize(`Proficiency.Defense.${sluggify(slug, { camel: "bactrian" })}`)
                            : game.i18n.localize(categoryLabel);
                        return {
                            slug,
                            label,
                            rank: selectedIncreases[slug]?.rank ?? null,
                        };
                    })
                    .sort((a, b) => a.label.localeCompare(b.label)),
            },
            classes: {
                group: localize("ClassDC.Plural"),
                options: R.toPairs
                    .strict(CONFIG.PF2E.classTraits)
                    .map(([slug, label]) => ({
                        slug,
                        label: game.i18n.localize(label),
                        attribute: selectedIncreases[slug]?.attribute ?? null,
                        rank: selectedIncreases[slug]?.rank ?? null,
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label)),
            },
        };
    }

    override activateListeners($html: JQuery<HTMLElement>): void {
        super.activateListeners($html);
        const html = $html[0];
        activateActionSheetListeners(this.item, html);

        const getInput = (name: string): HTMLInputElement | null => html.querySelector(`input[name="${name}"]`);
        tagify(getInput("system.prerequisites.value"), { maxTags: 6 });
        tagify(getInput("system.subfeatures.keyOptions"), { whitelist: CONFIG.PF2E.abilities, maxTags: 3 });

        // Proficiency increases
        const feat = this.item;
        const section = htmlQuery(html, "section[data-proficiencies]");
        const localizeIncreases = localizer("PF2E.Item.Feat.Subfeatures.Proficiencies");
        const availableIncreasesSelect = htmlQuery<HTMLSelectElement>(section, "select[data-available-increases]");
        availableIncreasesSelect?.addEventListener("change", (event) => {
            event.stopPropagation();
        });
        section?.addEventListener("click", (event) => {
            const anchor = htmlClosest(event.target, "a[data-action]");
            if (!anchor) return;
            if (anchor.dataset.action === "add-proficiency") {
                const slug = availableIncreasesSelect?.value;
                if (!slug) {
                    ui.notifications.error(localizeIncreases("NoOptionSelected"));
                    return;
                }

                const options = Object.values(this.#createProficiencyOptions())
                    .map((o) => o.options)
                    .flat(2)
                    .filter((o) => !o.rank)
                    .map((o) => o.slug);
                if (options.includes(slug)) {
                    const data = slug in CONFIG.PF2E.classTraits ? { rank: 1, attribute: null } : { rank: 1 };
                    feat.update({ [`system.subfeatures.proficiencies.${slug}`]: data });
                }
            } else if (anchor.dataset.action === "delete-proficiency") {
                const slug = anchor.dataset.slug ?? "";
                if (slug in feat.system.subfeatures.proficiencies) {
                    feat.update({ [`system.subfeatures.proficiencies.-=${slug}`]: null });
                }
            }
        });

        htmlQuery(html, "a[data-action=add-proficiencies")?.addEventListener("click", () => {});
    }

    override async _onDrop(event: ElementDragEvent): Promise<void> {
        return handleSelfEffectDrop(this, event);
    }

    protected override _updateObject(event: Event, formData: Record<string, unknown>): Promise<void> {
        // This will be here until we migrate feat prerequisites to be a list of strings
        if (Array.isArray(formData["system.prerequisites.value"])) {
            formData["system.prerequisites.value"] = formData["system.prerequisites.value"].map((value) => ({ value }));
        }

        // Keep feat data tidy
        const keyOptionsKey = "system.subfeatures.keyOptions";
        const hasEmptyKeyOptions = Array.isArray(formData[keyOptionsKey]) && formData[keyOptionsKey].length === 0;
        const hasNoKeyOptions = !(keyOptionsKey in formData);
        if (hasEmptyKeyOptions || hasNoKeyOptions) {
            delete formData[keyOptionsKey];
            if (this.item._source.system.subfeatures?.keyOptions) {
                formData["system.subfeatures.-=keyOptions"] = null;
            }
        }

        const pattern = /^system\.subfeatures\.proficiencies\.([a-z]+)\.to$/;
        const proficiencies = Object.keys(formData).filter((k) => pattern.test(k));
        for (const path of proficiencies) {
            const slug = pattern.exec(path)?.at(1);
            if (slug && slug in CONFIG.PF2E.classTraits && formData[path] !== 1) {
                delete formData[`system.subfeatures.proficiencies.${slug}.attribute`];
                formData[`system.subfeatures.proficiencies.${slug}.-=attribute`] = null;
            }
        }

        return super._updateObject(event, formData);
    }
}

interface FeatSheetData extends ItemSheetDataPF2e<FeatPF2e> {
    actionsNumber: typeof CONFIG.PF2E.actionsNumber;
    actionTypes: typeof CONFIG.PF2E.actionTypes;
    attributes: typeof CONFIG.PF2E.abilities;
    canHaveKeyOptions: boolean;
    categories: typeof CONFIG.PF2E.featCategories;
    frequencies: typeof CONFIG.PF2E.frequencies;
    hasLineageTrait: boolean;
    hasProficiencies: boolean;
    mandatoryTakeOnce: boolean;
    proficiencies: ProficiencyOptions;
    selfEffect: SelfEffectReference | null;
}

type ProficiencyOptions = {
    other: { group: string | null; options: { slug: string; label: string; rank: OneToFour | null }[] };
} & Record<
    "saves" | "attacks" | "defenses" | "classes",
    {
        group: string;
        options: { slug: string; label: string; rank: OneToFour | null }[];
    }
>;

export { FeatSheetPF2e };
