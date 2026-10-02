import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The favicon's ring and dot on a navy tile (iOS rounds the corners itself). */
export default function AppleIcon() {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "#1B1F2C",
			}}
		>
			<svg width="112" height="112" viewBox="0 0 24 24">
				<circle cx="10.5" cy="13.5" r="8" fill="none" stroke="#11B2BA" strokeWidth="3.4" />
				<circle cx="20.2" cy="3.8" r="2.7" fill="#11B2BA" />
			</svg>
		</div>,
		size
	);
}
