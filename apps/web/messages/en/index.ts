import change from "./change.json";
import common from "./common.json";
import efficiency from "./efficiency.json";
import enter from "./enter.json";
import footer from "./footer.json";
import header from "./header.json";
import hero from "./hero.json";
import meta from "./meta.json";
import methodology from "./methodology.json";
import notFound from "./notFound.json";
import winning from "./winning.json";

/** One file per namespace, so each part of the page owns its copy. */
const messages = {
	Common: common,
	Meta: meta,
	Header: header,
	Hero: hero,
	Winning: winning,
	Change: change,
	Enter: enter,
	Efficiency: efficiency,
	Methodology: methodology,
	Footer: footer,
	NotFound: notFound,
};

export default messages;
