"use client";

import { useTranslations } from "next-intl";

import { MEASURES, PERIODS } from "@fiberscope/core";

import { useDashboard } from "@/components/dashboard/context";

/** Period and measure: segmented controls with a teal thumb under the active option. */
export function Controls() {
	const t = useTranslations("Hero.controls");
	const tc = useTranslations("Common");
	const { period, measure, setPeriod, setMeasure } = useDashboard();
	return (
		<div className="flex flex-wrap gap-2.5 max-wide:w-full">
			<Segmented
				label={t("period")}
				options={PERIODS.map((value) => ({ value, label: tc(`periodLabel.${value}`) }))}
				value={period}
				onChange={setPeriod}
			/>
			<Segmented
				label={t("measure")}
				options={MEASURES.map((value) => ({ value, label: tc(`measureLabel.${value}`) }))}
				value={measure}
				onChange={setMeasure}
			/>
		</div>
	);
}

function Segmented<T extends string>({
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}) {
	const count = options.length;
	const index = options.findIndex((option) => option.value === value);
	return (
		<div
			role="group"
			aria-label={label}
			className="relative grid h-10 flex-[1_1_100%] rounded-[9px] border border-ln2 p-0.5 wide:h-8 wide:flex-none"
			style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
		>
			<span
				aria-hidden="true"
				className="absolute top-0.5 bottom-0.5 rounded-[7px] bg-teal transition-[left] duration-350 ease-thumb"
				style={{
					left: `calc(2px + ${index} * (100% - 4px) / ${count})`,
					width: `calc((100% - 4px) / ${count})`,
				}}
			/>
			{options.map((option) => {
				const on = option.value === value;
				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={on}
						onClick={() => onChange(option.value)}
						className={`relative z-1 border-0 bg-transparent px-3.5 font-mono text-[11.5px] leading-[normal] font-medium tracking-[.06em] whitespace-nowrap uppercase transition-colors duration-200 ${on ? "text-navy" : "text-mu"}`}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}
